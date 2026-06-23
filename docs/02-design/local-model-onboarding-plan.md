# Plan — Local Model Onboarding (hardware-aware Ollama model recommend + in-app install)

> Branch: `feat/multimedia-chat` (continues SP1 chat work).
> Status: **DRAFT for review** (PDCA Plan phase). Implementation NOT started.
> Trigger incident: user selected provider=Local(Ollama), model=`qwen2.5`, sent "안녕" → generic
> "문제가 발생했습니다". Root cause (reproduced via Electron `net.request`): Ollama **was running**,
> but **no models were pulled** (`ollama list` empty), so `POST /v1/chat/completions` → **404
> `model 'qwen2.5' not found`**, which the app mis-categorised as 'generic'.

---

## 1. Problem statement

Two distinct UX failures stacked on top of each other:

1. **Phantom models.** Settings → AI shows a HARDCODED model list (`MODELS_BY_PROVIDER['openai-compatible']` =
   `['llama3.1','qwen2.5','mistral','phi3']`) and defaults to `qwen2.5` **even for a local Ollama server that
   has none of them pulled**. For cloud providers a fixed list is fine (any account model works); for a LOCAL
   server it actively offers models that don't exist → guaranteed 404 on first send. *"없는 걸 왜 보여줘."*
2. **No path to a working model.** When nothing is installed, the user is dropped into a terminal (`ollama pull …`)
   with no guidance on **which** model their machine can actually run well.

Already shipped (this branch, gated, pending repackage):
- `'unreachable'` category for connection-refused (server-down case) + Settings/chat "Start Ollama" button.
- `'model-missing'` category for HTTP 404 (this incident) → actionable error string.

This plan covers the **next layer**: make the *local-model-from-zero* path first-class — detect hardware,
recommend the best-fitting model, and install it in-app with progress. No terminal.

---

## 2. Locked decisions (user-confirmed)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **GPU detection = NVIDIA (`nvidia-smi`) + RAM fallback.** Other vendors/no-GPU → recommend from system RAM only. | nvidia-smi is exact and ubiquitous on NVIDIA; AMD/Intel VRAM probing is unreliable + high code cost. RAM-only still yields a safe recommendation. |
| D2 | **Surface in BOTH** Settings → AI (manage) **and** the chat empty/`model-missing` state (just-in-time install). | First-run smoothness; the user hits the wall in chat, so the fix should be offered there too. |
| D3 | **In-app install via Ollama `/api/pull` streaming** (NDJSON progress), not a spawned `ollama pull`. | HTTP gives structured progress (`completed`/`total`) for a real progress bar; no child-process parsing; reuses the existing localhost trust boundary. |
| D4 | **PDCA plan first** (this doc), then implement. | 6+ files, OS/vendor matrix, streaming + progress UI. |

**Critical detection note (discovered live):** Windows **WMI `Win32_VideoController.AdapterRAM` is WRONG** — it
reported **4 GB** for an RTX 3080 Ti that `nvidia-smi` correctly reports as **12 GB** (WMI caps the DWORD at 4 GB).
→ VRAM MUST come from `nvidia-smi`, never WMI.

---

## 3. Architecture

Four units. All hardware/probe/pull logic lives in **main** (no renderer process spawn / no cross-origin fetch).

```
main/hardware-probe.ts      detectHardware() → { ramGB, cpu, gpu: {name, vramGB}|null, source }
shared/model-catalog.ts     MODEL_CATALOG[] + recommendModels(hw) → ranked Recommendation[]
main/ollama-manager.ts      (extend) pullModel(name, onProgress, signal) over /api/pull
main/index.ts               IPC: hardware:detect, ollama:recommend, ollama:pull(+progress event), ollama:list-installed
renderer                    Settings → AI "Install a model" block + chat empty-state install card
```

### 3.1 `hardware-probe.ts` (main)
```ts
export interface HardwareInfo {
  ramGB: number;                       // os.totalmem()/1GB, rounded
  cpu: { model: string; threads: number };
  gpu: { name: string; vramGB: number } | null;   // NVIDIA only (D1); null otherwise
  vramSource: 'nvidia-smi' | 'none';
}
export async function detectHardware(): Promise<HardwareInfo>
```
- RAM: `os.totalmem()`. CPU: `os.cpus()[0].model`, `os.cpus().length`.
- GPU: `execFile('nvidia-smi', ['--query-gpu=name,memory.total','--format=csv,noheader,nounits'])`, parse first row.
  - ENOENT / non-zero / parse fail → `gpu: null`, `vramSource: 'none'` (NOT an error — common + expected).
  - Multi-GPU: take the **max** VRAM row (the card inference will use).
- Hard timeout 4 s on the spawn; never throws (always returns a usable object).
- **No WMI.** (Documented anti-pattern: AdapterRAM is capped at 4 GB.)

### 3.2 `model-catalog.ts` (shared — no electron, testable in vitest)
Curated, conservative table of **Ollama** chat models. Sizes are the default-quant download size; `minVramGB`
is the comfortable "fits in VRAM, fast" threshold; `minRamGB` is the CPU-fallback ceiling.

```ts
export interface CatalogModel {
  id: string;          // ollama tag, e.g. 'qwen2.5:7b'
  label: string;       // 'Qwen2.5 7B'
  sizeGB: number;      // download size
  minVramGB: number;   // fits-in-VRAM threshold (GPU path)
  minRamGB: number;    // min system RAM (CPU path)
  multilingual: boolean; // Korean-capable (qwen2.5, llama3.1 ~ok, gemma2)
  blurb: string;       // one-line i18n-keyed hint
}
```
Seed set (subject to review; all current Ollama tags):

| id | sizeGB | minVramGB | minRamGB | multilingual | note |
|----|--------|-----------|----------|--------------|------|
| `qwen2.5:3b`  | 1.9 | 3  | 8  | yes | low-end / fast |
| `llama3.2:3b` | 2.0 | 3  | 8  | partial | English-leaning |
| `qwen2.5:7b`  | 4.7 | 6  | 16 | yes | **default sweet spot** |
| `qwen2.5:14b` | 9.0 | 11 | 32 | yes | high quality, fits 12GB VRAM |
| `qwen2.5:32b` | 20  | 22 | 48 | yes | needs big GPU/RAM |

`recommendModels(hw)`:
1. Budget = `hw.gpu ? hw.gpu.vramGB : null`.
2. If GPU: pick the **largest** model with `minVramGB <= vramGB`; mark it `recommended`. Include the next size up
   as `possible` (runs but spills to RAM/CPU) and one smaller as `safe`.
3. If no GPU: pick the largest with `minRamGB <= ramGB` (CPU inference).
4. Tie-break toward `multilingual` (user is Korean).
5. Always returns ≥1 (`qwen2.5:3b` floor) + a human reason string (i18n key + interpolated specs).

> Worked example (user's machine — RAM 32 GB, RTX 3080 Ti **12 GB**): budget=12 → largest fitting = `qwen2.5:14b`
> (minVram 11). Recommended **14b**, `safe`=7b, `possible`=32b(spills). Confirms the in-progress 7b pull is a fine
> conservative choice; 14b is the quality pick.

### 3.3 `ollama-manager.ts` extension — `pullModel`
```ts
export async function pullModel(
  name: string,
  onProgress: (p: { status: string; completedBytes: number; totalBytes: number }) => void,
  signal: AbortSignal,
): Promise<{ ok: boolean; reason?: 'unreachable'|'not-found'|'aborted'|'error' }>
```
- `POST http://localhost:11434/api/pull` body `{ name, stream: true }` over Electron `net.request`.
- Response is **NDJSON** (one JSON object per line): `{status, digest?, total?, completed?}`. Parse line-buffered
  (reuse chat-engine's `\n`-split buffering pattern), forward as progress.
- Terminal line `{"status":"success"}` → ok. A line with `error` → fail('not-found' if /not found/i, else 'error').
- `signal` aborts the request (cancel button). Idle/connect timeouts mirror chat-engine constants.
- `name` is constrained: must match an `id` in `MODEL_CATALOG` (renderer can't pull arbitrary strings — see §6).

### 3.4 Phantom-models fix (the "왜 보여줘")
In `SettingsModal` AITab, for `provider==='openai-compatible'` **with a local baseURL**:
- The model `<select>` is populated **only** from `ollama:list-installed` (live `/v1/models`), NOT
  `MODELS_BY_PROVIDER`. (Remote openai-compatible + cloud providers keep the current fallback list.)
- Installed = 0 → hide the dropdown, show the **Install-a-model card** (§5) instead.
- After a successful pull → refresh installed list, auto-select the new model.

---

## 4. IPC surface (4 new channels + 1 event)

| channel | args | result | notes |
|---------|------|--------|-------|
| `hardware:detect` | `[]` | `HardwareInfo` | cached 60 s in main |
| `ollama:list-installed` | `[opts?:{baseURL?}]` | `string[]` | thin wrapper over `/v1/models` (reuses probe path) |
| `ollama:recommend` | `[]` | `{ hw: HardwareInfo; recs: Recommendation[] }` | detect + recommend in one call |
| `ollama:pull` | `[{ model: string; pullId: string }]` | `void` | progress via event; validates model ∈ catalog |
| event `ollama:pull-progress` | — | `{ pullId, status, completedBytes, totalBytes, done?, error? }` | e.sender-targeted, filtered by pullId (mirror chat streaming) |
| `ollama:pull-abort` | `[pullId]` | `void` | abort an in-flight pull |

All added to `ipc-types.ts` **and** the preload allowlist (the `ipc-security.test.ts:80` "every typed channel is
allowlisted" gate enforces both). Pull progress event added to `ALLOWED_EVENTS` + `IpcEventMap`.

---

## 5. UI

### 5.1 Settings → AI (local provider, manage)
- Existing "로컬 서버" status row (Ollama running / start) stays.
- New **"모델"** area when local + reachable:
  - If ≥1 installed → dropdown of **installed** models only.
  - If 0 installed → **Install card**: "감지: RAM 32GB · RTX 3080 Ti 12GB → 추천 **Qwen2.5 14B** (9GB) [설치]"
    + a collapsible list of alternatives (3b/7b/32b) each with size + [설치].
  - During pull → progress bar (`completed/total` %, MB), [취소] button. On success → select model.

### 5.2 Chat empty / `model-missing` state
- When category==='model-missing' AND local provider: the error bubble's action becomes **"모델 설치"** →
  opens the same recommend+install card inline (or routes to Settings → AI with the card focused).
- Reuses `MessageBubble.action` (already added for "Start Ollama").

### 5.3 i18n
New `en`/`ko` keys under `settings.ai.model.*` and `panel.ai.*`: detected-specs line, recommend reason,
size labels, install/cancel/installing, pull-progress, pull-failed, no-gpu note. (~14 keys.)

---

## 6. Security / threat model

- **Arbitrary pull blocked.** `ollama:pull` rejects any `model` not present in `MODEL_CATALOG` (no
  renderer-driven pull of attacker-named tags / no command surface). Catalog is the allowlist.
- **No shell.** nvidia-smi via `execFile('nvidia-smi', [...])` (fixed binary, arg array) — no `shell:true`.
- **localhost only.** pull/list target the configured loopback baseURL; `isLocalProviderUrl` gates the UI so we
  never POST `/api/pull` to a remote host.
- **DoS.** One active pull per window (pullId registry, cap 1); `ollama:pull-abort` + before-quit abort.
- **Privacy.** Hardware info (RAM/CPU/GPU model) stays local; never sent to any provider. nvidia-smi output is
  parsed for the two fields only; never logged raw.
- **No data integrity risk** (read-only detection; pull writes only into Ollama's own model store).

---

## 7. Tests

- `model-catalog.test.ts` (pure): `recommendModels` across RAM/VRAM matrix — 4GB no-GPU → 3b; 32GB+12GB VRAM →
  14b recommended/7b safe/32b possible; multilingual tie-break; always ≥1.
- `hardware-probe.test.ts`: nvidia-smi CSV parse (single + multi-GPU max), ENOENT → gpu:null, timeout → null.
  (electron mocked; execFile mocked.)
- `ollama-pull.test.ts`: NDJSON line buffering → progress callbacks; `{status:success}`→ok; error line /not
  found/ → 'not-found'; abort → 'aborted'.
- `ipc-security` additions: 4 channels + event in allowlist; pull validates catalog membership.
- chat-engine: existing 404→model-missing already covered.
- Gates: tsc 0 · desktop vitest green · `node tests/smoke.mjs` 15→+cases.

## 8. Manual Browser/Device Gate (commit-blocking — Node can't verify)

External process (`nvidia-smi`) + GPU-dependent + streaming download. Checklist:
- [ ] Settings → AI (no models) shows correct detected specs (RAM + GPU + VRAM) for THIS machine.
- [ ] Recommended model matches the machine (12GB → 14b or 7b, not 32b as primary).
- [ ] [설치] streams a visible progress bar to completion; model then appears in the dropdown + chat works.
- [ ] [취소] mid-pull stops the download.
- [ ] Machine with NO NVIDIA GPU (or nvidia-smi absent) → falls back to RAM-based rec, no crash.
- [ ] Chat `model-missing` → "모델 설치" path installs + the retried message answers.

## 9. Task breakdown (implementation order)

- **T1** `model-catalog.ts` + `recommendModels` + tests (pure, no deps) — lock the recommendation logic first.
- **T2** `hardware-probe.ts` (nvidia-smi + RAM) + tests.
- **T3** `ollama-manager.pullModel` (/api/pull NDJSON) + `listInstalled` + tests.
- **T4** ipc-types + index.ts handlers + pull registry/abort/before-quit + preload allowlist.
- **T5** Settings AITab: installed-only dropdown + Install card + progress.
- **T6** chat empty/model-missing → "모델 설치" action wiring.
- **T7** i18n en/ko.
- **T8** gates (tsc/vitest/smoke) + Manual Gate + repackage.

## 10. Out of scope (later)

- AMD/Intel/Apple-Silicon precise VRAM (D1). Apple unified-memory could be a cheap follow-up (vram≈ram).
- Quantization picker (Q4/Q8), model deletion UI, concurrent multi-pull.
- Non-Ollama local backends (LM Studio model mgmt).

## 11. Reuses / does not break

- Reuses: `isLocalProviderUrl`, ollama-manager probe path, `MessageBubble.action`, chat streaming-registry pattern,
  i18n + ipc allowlist test harness.
- Untouched: cloud providers' fixed model list, Ask/Wiki, SP1 chat send/abort/session paths.
