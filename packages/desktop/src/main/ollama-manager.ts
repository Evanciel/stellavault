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
import { OLLAMA_BASE_URL } from '../shared/ai-providers.js';

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
