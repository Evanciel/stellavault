// Stellavault Desktop — Ollama lifecycle helper (main process).
//
// "Start Ollama" UX (SP1 follow-up): when the user picks the Local (Ollama) provider
// and the server isn't up, the app offers to start it instead of failing with a
// generic error. This module probes reachability over HTTP and spawns `ollama serve`.
//
// Security invariants:
//  - NOTHING here takes a binary path or arguments from the renderer. The spawned
//    command is a FIXED binary name resolved from PATH / well-known install locations
//    + the literal ['serve'] — never a shell string (no shell:true → no injection).
//  - The only renderer-supplied input is an optional baseURL, used solely for the
//    HTTP health probe (GET {base}/models); it never reaches the spawn.

import { execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { app, net } from 'electron';
import { OLLAMA_BASE_URL, isLocalProviderUrl } from '../shared/ai-providers.js';

const PROBE_TIMEOUT_MS = 2_000;
const START_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 500;

export type StartReason = 'already-running' | 'not-installed' | 'spawn-failed' | 'timeout';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET {base}/models with a short timeout. ANY HTTP answer (even 404) means the
 *  server is up; a connection error / timeout means it's down. Never throws. */
export async function probeReachable(baseURL: string): Promise<boolean> {
  const base = (baseURL || OLLAMA_BASE_URL).replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await net.fetch(`${base}/models`, { method: 'GET', signal: ctrl.signal });
    // The presence of a Response = the server answered (status 200/401/404 all count).
    return res.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const OLLAMA_BIN = process.platform === 'win32' ? 'ollama.exe' : 'ollama';

/** Directory where an app-managed (auto-downloaded) Ollama lives. We co-locate it with
 *  the user's models drive when OLLAMA_MODELS is set (e.g. A:\Ollama\models → A:\Ollama\bin),
 *  so a self-installed Ollama lands on the same (roomy) drive as the models — never forced
 *  onto the system drive. Falls back to userData when no models dir is configured. */
function appManagedBinDir(): string | null {
  const md = process.env.OLLAMA_MODELS;
  if (md) return join(dirname(md), 'bin');
  try {
    return join(app.getPath('userData'), 'ollama', 'bin');
  } catch {
    return null; // app not ready (e.g. unit tests) — managed path simply unavailable
  }
}

/** Well-known absolute install locations per OS (checked before falling back to PATH). */
function candidatePaths(): string[] {
  const home = homedir();
  const managedDir = appManagedBinDir();
  const managed = managedDir ? [join(managedDir, OLLAMA_BIN)] : [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return [
      ...managed,
      join(local, 'Programs', 'Ollama', 'ollama.exe'),
      'C:\\Program Files\\Ollama\\ollama.exe',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      ...managed,
      '/usr/local/bin/ollama',
      '/opt/homebrew/bin/ollama',
      '/Applications/Ollama.app/Contents/Resources/ollama',
    ];
  }
  return [...managed, '/usr/local/bin/ollama', '/usr/bin/ollama', join(home, '.local', 'bin', 'ollama')];
}

/** Resolve a runnable ollama command: a known-existing absolute path, or the bare
 *  name 'ollama' if it runs from PATH (`--version` exits 0). null → not installed. */
export async function findOllamaCommand(): Promise<string | null> {
  for (const p of candidatePaths()) {
    if (existsSync(p)) return p;
  }
  // Fall back to PATH: a 0-exit `ollama --version` proves it's runnable.
  return new Promise((resolve) => {
    try {
      execFile('ollama', ['--version'], { windowsHide: true, timeout: 4_000 }, (err) => {
        resolve(err ? null : 'ollama');
      });
    } catch {
      resolve(null);
    }
  });
}

export interface OllamaStatus { reachable: boolean; installed: boolean; }

/** Reachability (HTTP up?) + installed (binary found?) for the Settings status row. */
export async function ollamaStatus(baseURL: string): Promise<OllamaStatus> {
  const reachable = await probeReachable(baseURL);
  // If it answers HTTP it is, by definition, installed — skip the extra spawn probe.
  const installed = reachable ? true : (await findOllamaCommand()) !== null;
  return { reachable, installed };
}

export interface StartResult { ok: boolean; reason?: StartReason; }

/** Start `ollama serve` (if not already up) and poll until the HTTP API answers.
 *  Detached + unref'd with ignored stdio so the server is independent of this app's
 *  lifetime and never grows an in-memory output buffer. */
export async function startOllama(baseURL: string): Promise<StartResult> {
  if (await probeReachable(baseURL)) return { ok: true, reason: 'already-running' };
  const cmd = await findOllamaCommand();
  if (!cmd) return { ok: false, reason: 'not-installed' };
  try {
    const child = spawn(cmd, ['serve'], { windowsHide: true, detached: true, stdio: 'ignore' });
    // A late spawn failure (e.g. EACCES) surfaces here; we're already polling, so just log.
    child.on('error', (err) => console.error('[ollama] serve spawn error:', err?.message));
    child.unref();
  } catch (err) {
    console.error('[ollama] failed to spawn serve:', (err as Error)?.message);
    return { ok: false, reason: 'spawn-failed' };
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    if (await probeReachable(baseURL)) return { ok: true };
  }
  return { ok: false, reason: 'timeout' };
}

// ─── Version / compatibility (feature: "compat check") ──────────────────────────
//
// Current-gen models (gemma3/4, qwen3.x, llama4, …) ship manifests that older Ollama
// servers reject with HTTP 412 ("requires a newer version of Ollama"). We surface that
// BEFORE the user hits it: detect the installed version and compare to a known floor.

/** Minimum Ollama version we consider compatible with current-generation models.
 *  Empirically, 0.20.x fails 412 on gemma4/qwen3.5; 0.30.x pulls them fine. */
export const MIN_OLLAMA_VERSION = '0.30.0';

/** Parse "x.y.z" out of arbitrary version text → [x, y, z] (missing parts = 0). */
function parseVersion(v: string): [number, number, number] {
  const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** Semver-ish compare: <0 if a<b, 0 if equal, >0 if a>b (patch-level precision). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a), pb = parseVersion(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Run `<bin> --version` and extract the version string. Note: when the server isn't
 *  running, Ollama still prints "client version is x.y.z" (to stdout or stderr), so we
 *  scan both. null → couldn't determine (binary missing / unparseable). */
function ollamaVersionAt(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(bin, ['--version'], { windowsHide: true, timeout: 5_000 }, (_err, stdout, stderr) => {
        const m = `${stdout || ''}\n${stderr || ''}`.match(/(\d+\.\d+\.\d+)/);
        resolve(m ? m[1] : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** Installed Ollama version (resolved via the same command findOllamaCommand() uses). */
export async function getOllamaVersion(): Promise<string | null> {
  const cmd = await findOllamaCommand();
  return cmd ? ollamaVersionAt(cmd) : null;
}

export interface OllamaCompat {
  installed: boolean;
  version: string | null;
  minVersion: string;
  /** installed but older than the current-model floor → recommend update. */
  outdated: boolean;
}

/** Status for the Settings compat row: is Ollama present, and is it new enough? */
export async function checkCompat(): Promise<OllamaCompat> {
  const version = await getOllamaVersion();
  const installed = version !== null;
  const outdated = installed ? compareVersions(version!, MIN_OLLAMA_VERSION) < 0 : false;
  return { installed, version, minVersion: MIN_OLLAMA_VERSION, outdated };
}

// ─── Tool-calling capability (agent SP-A, Design Ref: §2.1) ──────────────────
// The agent loop only engages when the configured local model advertises the 'tools'
// capability. gemma4:e4b → ['completion','vision','audio','tools','thinking']; gemma2:9b
// has none and 400s if sent a tools[] array — this gate prevents that.

/** Strip the OpenAI-compat `/v1` suffix → the native API root (where /api/show lives). */
function nativeBase(baseURL: string): string {
  return (baseURL || OLLAMA_BASE_URL).replace(/\/+$/, '').replace(/\/v1$/, '');
}

const capCache = new Map<string, boolean>();

/** Does this local model advertise `capability` (e.g. 'tools', 'vision')? Queries POST
 *  /api/show and checks `capabilities`. Cached per (base, model, capability). Fail-closed:
 *  ANY error → false (so a probe failure never silently sends an unsupported payload). */
async function modelHasCapability(baseURL: string, model: string, capability: string): Promise<boolean> {
  if (!model) return false;
  const base = nativeBase(baseURL);
  const key = `${base}::${model}::${capability}`;
  const cached = capCache.get(key);
  if (cached !== undefined) return cached;
  let supported = false;
  try {
    const res = await net.fetch(`${base}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    });
    if (res.ok) {
      const json = (await res.json()) as { capabilities?: unknown };
      supported = Array.isArray(json.capabilities) && json.capabilities.includes(capability);
    }
  } catch {
    supported = false;
  }
  capCache.set(key, supported);
  return supported;
}

/** Does this local model advertise the 'tools' capability? (agent loop gate — gemma2:9b 400s
 *  on a tools[] array, so this prevents sending one.) */
export function modelSupportsTools(baseURL: string, model: string): Promise<boolean> {
  return modelHasCapability(baseURL, model, 'tools');
}

/** Does this local model advertise the 'vision' capability? (SP2 image-attachment gate — only
 *  send `images:[]` to a vision model; a text-only model would error or ignore them.) */
export function modelSupportsVision(baseURL: string, model: string): Promise<boolean> {
  return modelHasCapability(baseURL, model, 'vision');
}

// ─── Auto-download (feature: "download latest Ollama when missing") ─────────────
//
// SECURITY: the download is fully self-determined — the renderer triggers it but supplies
// NOTHING. The release is fetched from a FIXED GitHub API URL; the asset is matched by a
// FIXED per-platform filename; the resolved download URL must be GitHub-hosted; the archive
// extracts via a FIXED command (no shell) to an app-controlled directory. No renderer input
// reaches any URL, path, or command.

const OLLAMA_RELEASES_API = 'https://api.github.com/repos/ollama/ollama/releases/latest';

/** Exact release-asset filename for this platform (null = unsupported → manual install). */
function expectedAssetName(): string | null {
  if (process.platform === 'win32') return 'ollama-windows-amd64.zip';
  if (process.platform === 'linux') return 'ollama-linux-amd64.tgz';
  if (process.platform === 'darwin') return 'ollama-darwin.tgz';
  return null;
}

export function isGitHubHost(url: string): boolean {
  try {
    const h = new URL(url).host.toLowerCase();
    return h === 'github.com' || h.endsWith('.github.com') || h.endsWith('.githubusercontent.com');
  } catch {
    return false;
  }
}

interface ReleaseAsset { name: string; browser_download_url: string; size: number; }

/** Resolve the platform asset on the latest GitHub release. null on any failure. */
async function resolveLatestAsset(): Promise<{ url: string; size: number; tag: string } | null> {
  const want = expectedAssetName();
  if (!want) return null;
  try {
    const res = await net.fetch(OLLAMA_RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const json = (await res.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
    const asset = (json.assets || []).find((a) => a.name === want);
    if (!asset || !isGitHubHost(asset.browser_download_url)) return null;
    return { url: asset.browser_download_url, size: asset.size, tag: json.tag_name || '' };
  } catch {
    return null;
  }
}

/** Extract a downloaded archive with a FIXED command (no shell). Paths are app-controlled. */
function extractArchive(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (err: Error | null) => (err ? reject(err) : resolve());
    if (process.platform === 'win32') {
      // Expand-Archive: single-quote the (app-controlled) paths and double any quotes.
      const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
      execFile('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath ${q(archivePath)} -DestinationPath ${q(destDir)} -Force`,
      ], { windowsHide: true, timeout: 180_000 }, done);
    } else {
      execFile('tar', ['-xzf', archivePath, '-C', destDir], { timeout: 180_000 }, done);
    }
  });
}

export type DownloadPhase = 'fetching' | 'downloading' | 'extracting' | 'done';
export interface DownloadProgress { phase: DownloadPhase; received?: number; total?: number; }
export type InstallResult =
  | { ok: true; binPath: string; version: string | null }
  | { ok: false; reason: string };

/** Download the latest Ollama release for this platform and install it to the app-managed
 *  bin dir (on the models drive when configured). onProgress streams download bytes so the
 *  renderer can show a progress bar. Returns the resolved binary path on success. */
export async function downloadAndInstallOllama(
  onProgress?: (p: DownloadProgress) => void,
): Promise<InstallResult> {
  const assetName = expectedAssetName();
  const binDir = appManagedBinDir();
  if (!assetName) return { ok: false, reason: 'unsupported-platform' };
  if (!binDir) return { ok: false, reason: 'no-install-dir' };
  try {
    onProgress?.({ phase: 'fetching' });
    const asset = await resolveLatestAsset();
    if (!asset) return { ok: false, reason: 'asset-not-found' };

    const root = dirname(binDir);
    await mkdir(root, { recursive: true });
    const archivePath = join(root, assetName);

    const res = await net.fetch(asset.url);
    if (!res.ok || !res.body) return { ok: false, reason: `http-${res.status}` };
    const total = asset.size || Number(res.headers.get('content-length')) || 0;

    // Stream to disk (never buffer the whole ~1.4GB archive in memory).
    const fileStream = createWriteStream(archivePath);
    const reader = res.body.getReader();
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (!fileStream.write(Buffer.from(value))) {
            await new Promise<void>((r) => fileStream.once('drain', r));
          }
          received += value.length;
          onProgress?.({ phase: 'downloading', received, total });
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });
    }

    onProgress?.({ phase: 'extracting' });
    await mkdir(binDir, { recursive: true });
    await extractArchive(archivePath, binDir);
    await rm(archivePath, { force: true });

    const binPath = join(binDir, OLLAMA_BIN);
    if (!existsSync(binPath)) return { ok: false, reason: 'extract-missing-binary' };
    onProgress?.({ phase: 'done' });
    return { ok: true, binPath, version: await ollamaVersionAt(binPath) };
  } catch (err) {
    return { ok: false, reason: (err as Error)?.message || 'unknown' };
  }
}

// ─── 모델 설치 (ollama pull) ────────────────────────────────────────────────
//
// 위쪽 런타임 다운로드는 "렌더러가 아무것도 안 준다" 가 안전 근거였다. 여기는 다르다 —
// 렌더러가 <모델 이름>을 준다. 그게 이 기능의 전부다(새 모델이 오늘 나오면 오늘 쓰는 것).
// 그래서 그 문자열이 URL 경로와 요청 본문에 닿기 전에 좁은 문법으로 먼저 자른다.
//
// 이 구조를 고른 이유: Ollama 에는 "설치 가능한 모델 목록" API 가 없다(ollama.com/api/search
// 는 404, 목록은 HTML 뿐이다). 목록을 코드에 박아두면 릴리스마다 손으로 갱신해야 하고 —
// 실제로 llama3.1/qwen2.5 에서 멈춰 있었다 — 새 모델은 항상 한 박자 늦는다. 반대로 레지스트리는
// <임의의 이름 하나>를 확인해 준다. 이름을 받아 확인하고 받으면, 카탈로그 없이도 안 밀린다.

/** 모델 참조의 한 조각. 영숫자로 시작 — 그래서 `.` `..` 는 문법상 들어올 수 없다. */
const MODEL_SEG = /^[a-z0-9][a-z0-9._-]*$/i;

/** Ollama 가 허깅페이스 GGUF 를 직접 받는 접두어 — 이때만 조각이 셋이다(host/user/repo). */
const HF_HOSTS = new Set(['hf.co', 'huggingface.co']);

/**
 * `[네임스페이스/]이름[:태그]` 인가.
 *
 * 조각은 최대 둘이다 — 단 `hf.co/<유저>/<레포>` 형태만 셋을 허용한다. Ollama 가 그 형태로
 * 허깅페이스 GGUF 를 바로 받기 때문이다(실측: `ollama pull hf.co/unsloth/SmolLM2-135M-
 * Instruct-GGUF` 성공). 무한정 열지 않고 <아는 호스트일 때만> 한 칸 더 주는 이유는, 조각 수를
 * 그냥 늘리면 임의 깊이의 경로가 URL 로 들어가는 문을 여는 것이기 때문이다.
 */
export function isValidModelRef(ref: string): boolean {
  if (!ref || ref.length > 160) return false;
  const parts = ref.split(':');
  if (parts.length > 2) return false;
  if (parts[1] !== undefined && !MODEL_SEG.test(parts[1])) return false;
  const segs = parts[0].split('/');
  const max = HF_HOSTS.has(segs[0]?.toLowerCase()) ? 3 : 2;
  if (segs.length > max) return false;
  return segs.every((s) => MODEL_SEG.test(s));
}

const OLLAMA_REGISTRY = 'registry.ollama.ai';

/**
 * 응답이 핀한 호스트에서 온 것이 <맞는가>.
 *
 * ⚠️ electron 의 net.fetch 는 `response.url` 을 빈 문자열로 준다. 처음엔 그 값만 보고
 *    판정했는데, 그러면 <모든> 조회가 "확인 못 함" 으로 떨어진다 — 실제로 라이브에서
 *    카탈로그 0개 · 이름 확인 전부 null 로 관측하고 잡았다. 그래서 진짜 방어는 위의
 *    `redirect: 'error'` 가 하고, 이 검사는 url 이 <실제로 있을 때만> 보조로 건다.
 */
function hostIsPinned(res: { url?: string }, host: string): boolean {
  if (!res.url) return true;          // 값이 없으면 이 검사로는 아무 말도 할 수 없다
  try {
    return new URL(res.url).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/**
 * 그 이름의 모델이 공개 레지스트리에 <실제로> 있는가.
 *
 * 몇 GB 짜리 pull 을 시작하기 전에 "그런 모델 없다" 를 말할 수 있게 한다.
 * ⚠️ 반환이 3값이다 — `false`("없다") 와 `null`("확인 못 했다") 는 다른 말이다. 오프라인일 때
 *    없다고 단정하면, 멀쩡한 이름을 사용자가 못 받게 막는다.
 */
export async function modelExistsInRegistry(ref: string): Promise<boolean | null> {
  if (!isValidModelRef(ref)) return false;
  const [pathPart, tag = 'latest'] = ref.split(':');

  // 🔴 hf.co 이름을 Ollama 레지스트리에 물으면 <있는 모델도 없다>고 답한다 — 거기 없는 게
  //    당연하다. 그 false 가 UI 의 사전 확인을 타고 설치를 막았다(라이브에서 관측: 확인은
  //    false 인데 실제 pull 은 성공). 출처가 다르면 묻는 곳도 달라야 한다.
  const hfSegs = pathPart.split('/');
  if (HF_HOSTS.has(hfSegs[0]?.toLowerCase())) {
    if (hfSegs.length !== 3) return false;
    try {
      const res = await net.fetch(`https://${HF_HOST}/api/models/${hfSegs[1]}/${hfSegs[2]}`, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
      });
      if (!hostIsPinned(res, HF_HOST)) return null;
      if (res.status === 200) return true;
      // 허깅페이스는 <없음>과 <비공개>를 구분해 흘리지 않으려고 둘 다 401 을 준다.
      // 어느 쪽이든 받을 수 없다는 점은 같다.
      if (res.status === 401 || res.status === 404) return false;
      return null;
    } catch {
      return null;
    }
  }

  // 네임스페이스가 없으면 공식 라이브러리다 — 도커 레지스트리 규약과 같은 모양.
  const repo = pathPart.includes('/') ? pathPart : `library/${pathPart}`;
  try {
    const res = await net.fetch(`https://${OLLAMA_REGISTRY}/v2/${repo}/manifests/${tag}`, {
      headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' },
      // 핀을 벗어나는 홉은 <따라가지 않는다>. 두 엔드포인트 모두 리다이렉트가 없으니
      // 정상 경로를 막지도 않는다(실측 2026-08-25: redirects=0).
      redirect: 'error',
    });
    if (!hostIsPinned(res, OLLAMA_REGISTRY)) return null;
    if (res.status === 200) return true;
    if (res.status === 401 || res.status === 404) return false;  // 비공개/없음 — 어느 쪽이든 못 받는다
    return null;
  } catch {
    return null;
  }
}

export type PullPhase = 'verifying' | 'pulling' | 'done';
export interface PullProgress {
  phase: PullPhase;
  /** Ollama 가 주는 단계 문구 그대로 (예: "pulling manifest", "verifying sha256 digest"). */
  status?: string;
  received?: number;
  total?: number;
}
export type PullResult = { ok: true } | { ok: false; reason: string };

/**
 * 로컬 Ollama 에 모델을 내려받는다. `POST /api/pull` 의 NDJSON 스트림을 진행률로 바꿔 흘린다.
 *
 * 🔴 로컬이 아니면 거부한다. openai-compatible 은 Groq·OpenRouter 같은 원격 호스트도 되는데,
 *    거기엔 `/api/pull` 이 없을뿐더러 — 사용자가 넣은 임의 호스트로 POST 를 쏘는 자리가 된다.
 */
export async function pullModel(
  baseURL: string,
  ref: string,
  onProgress?: (p: PullProgress) => void,
  signal?: AbortSignal,
): Promise<PullResult> {
  if (!isValidModelRef(ref)) return { ok: false, reason: 'invalid-model' };
  if (!isLocalProviderUrl(baseURL || OLLAMA_BASE_URL)) return { ok: false, reason: 'not-local' };
  try {
    const res = await net.fetch(`${nativeBase(baseURL)}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ref, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) return { ok: false, reason: `http-${res.status}` };

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let lastError = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // NDJSON — 줄 단위로 끊고, 잘린 마지막 조각은 다음 청크에 이어 붙인다. 한 줄이
      // 청크 경계에 걸리는 일은 수 GB 를 받는 동안 반드시 일어난다.
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line) as
            { status?: string; error?: string; completed?: number; total?: number };
          // 에러는 스트림 <안>으로 온다 — HTTP 는 200 인 채로. 여기서 안 읽으면 성공이 된다.
          if (j.error) { lastError = j.error; continue; }
          onProgress?.({ phase: 'pulling', status: j.status, received: j.completed, total: j.total });
        } catch { /* 깨진 줄 하나로 몇 GB 를 버리지 않는다 */ }
      }
    }
    if (lastError) return { ok: false, reason: lastError };
    onProgress?.({ phase: 'done' });
    return { ok: true };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return { ok: false, reason: 'aborted' };
    return { ok: false, reason: (err as Error)?.message || 'unknown' };
  }
}

// ─── 카탈로그 둘러보기 ──────────────────────────────────────────────────────
//
// "이름을 알면 받는다" 만으로는 부족하다 — 사용자가 <무엇이 새로 나왔는지> 모르면 이름을
// 넣을 수가 없다. 그런데 Ollama 에는 목록 API 가 없다(ollama.com/api/search 는 404).
// 남은 길은 라이브러리 페이지를 읽는 것뿐이라, 그렇게 한다. 대신 <깨질 수 있다>는 전제로 짠다:
//   · 뽑아내는 것은 `/library/<이름>` 링크의 이름 하나뿐 — 원격 HTML 에서 앱으로 넘어오는
//     것이 모델명 문자집합([a-z0-9._-])을 벗어날 수 없다. 페이지 내용은 데이터지 지시가 아니다.
//   · 0개가 나오면 <조용히 빈 목록>이 아니라 실패로 보고한다. 사이트가 개편됐을 때 "새 모델이
//     하나도 없다" 처럼 보이는 것이 이 기능에서 제일 나쁜 고장이다.
//   · 실패해도 내장 목록과 직접 입력은 그대로 산다. 이건 편의지 유일한 경로가 아니다.

const OLLAMA_SITE = 'ollama.com';
const BROWSE_MAX = 300;
const BROWSE_TTL_MS = 30 * 60_000;
/** 페이지가 아무리 커져도 읽는 양을 묶는다(현재 ~800KB). */
const BROWSE_MAX_BYTES = 4 * 1024 * 1024;

const browseCache = new Map<string, { at: number; models: string[] }>();

export type BrowseSort = 'newest' | 'popular';
export interface BrowseResult { models: string[]; error?: string }

/** 공개 라이브러리에서 모델 이름을 가져온다. newest 는 페이지 순서가 곧 최신순이다. */
export async function browseRegistry(sort: BrowseSort = 'newest'): Promise<BrowseResult> {
  const cached = browseCache.get(sort);
  if (cached && Date.now() - cached.at < BROWSE_TTL_MS) return { models: cached.models };
  try {
    const url = `https://${OLLAMA_SITE}/library${sort === 'newest' ? '?sort=newest' : ''}`;
    const res = await net.fetch(url, { headers: { Accept: 'text/html' }, redirect: 'error' });
    if (!hostIsPinned(res, OLLAMA_SITE)) return { models: [], error: 'redirected' };
    if (!res.ok) return { models: [], error: `http-${res.status}` };

    const buf = await res.arrayBuffer();
    if (buf.byteLength > BROWSE_MAX_BYTES) return { models: [], error: 'too-large' };
    const html = new TextDecoder().decode(buf);

    // 페이지 순서를 그대로 살린다 — newest 정렬의 의미가 순서에 들어 있다.
    const seen = new Set<string>();
    for (const m of html.matchAll(/href="\/library\/([a-z0-9][a-z0-9._-]*)"/gi)) {
      const name = m[1].toLowerCase();
      if (isValidModelRef(name)) seen.add(name);
      if (seen.size >= BROWSE_MAX) break;
    }
    const models = [...seen];
    // 0개 = 마크업이 바뀐 것이다. 빈 목록으로 돌려주면 "새 모델 없음" 으로 읽힌다.
    if (models.length === 0) return { models: [], error: 'no-matches' };

    browseCache.set(sort, { at: Date.now(), models });
    return { models };
  } catch (err) {
    return { models: [], error: (err as Error)?.message || 'unknown' };
  }
}

// ─── 허깅페이스 GGUF 검색 ───────────────────────────────────────────────────
//
// Ollama 라이브러리는 큐레이션된 수백 개지만, 실제로 도는 로컬 모델의 대부분은 허깅페이스에
// GGUF 로 올라온다. 그리고 Ollama 는 그것을 `hf.co/<유저>/<레포>` 로 <직접> 받는다
// (실측 2026-08-25: `ollama pull hf.co/unsloth/SmolLM2-135M-Instruct-GGUF` 성공).
//
// 여기는 긁지 않는다 — 허깅페이스는 공개 JSON API 가 있다. 그래서 Ollama 쪽보다 깨질 여지가
// 훨씬 적고, 검색과 정렬이 서버에서 된다(10만 개가 넘어 목록만으로는 아무 의미가 없다).
//
// ⚠️ 기본 정렬이 <다운로드순>인 이유: lastModified 로 뽑으면 방금 올라온 다운로드 0 짜리
//    개인 실험 레포가 위를 채운다(실측). "최신" 이 곧 "쓸 만함" 이 아닌 데이터다.

const HF_HOST = 'huggingface.co';
const HF_MAX = 50;

/** 검색어는 URL 질의로 들어간다 — 길이를 묶고 인코딩한다. 빈 검색어면 인기순 상위를 준다. */
export async function searchHuggingFace(query: string): Promise<BrowseResult> {
  const q = (query || '').trim().slice(0, 80);
  const params = new URLSearchParams({
    filter: 'gguf',
    sort: 'downloads',
    direction: '-1',
    limit: String(HF_MAX),
  });
  if (q) params.set('search', q);
  try {
    const res = await net.fetch(`https://${HF_HOST}/api/models?${params}`, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
    });
    if (!hostIsPinned(res, HF_HOST)) return { models: [], error: 'redirected' };
    if (!res.ok) return { models: [], error: `http-${res.status}` };

    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) return { models: [], error: 'bad-shape' };

    const models: string[] = [];
    for (const row of json) {
      const id = (row as { id?: unknown })?.id;
      if (typeof id !== 'string') continue;
      const ref = `hf.co/${id}`;
      // 응답은 남이 쓴 데이터다 — pull 에 넘기기 전에 같은 문법으로 자른다.
      if (isValidModelRef(ref)) models.push(ref);
    }
    // 결과 0개는 <그런 모델이 없다>는 정상 응답일 수 있다(검색어가 있을 때). 검색어가 없는데
    // 0개면 API 셰입이 바뀐 것이다 — 그때만 실패로 부른다.
    if (models.length === 0 && !q) return { models: [], error: 'no-matches' };
    return { models };
  } catch (err) {
    return { models: [], error: (err as Error)?.message || 'unknown' };
  }
}
