# Stellavault Desktop — Always-On Second Brain — Integrated Design

> **Status:** Design-level (architecture + signatures + schema). **Lead-architect synthesis** of five subsystem designs (D1 Capture, D2 Classify/Smart-Auto, D3 Data/Retrieval, D4 UI/UX, D5 Always-On/Phasing), produced by an 11-agent ultracode workflow (5 investigate → 5 design → 1 synthesize). Conflicts between the five are resolved and flagged inline as **`[RESOLVED]`**; remaining gaps as **`[GAP]`**; user-facing choices as **`[OPEN]`**.
> **Created:** 2026-06-15 · **Source workflow:** `second-brain-autocapture-design` (wf_eb444a30-416)
> **Verified anchors (this codebase):** `DEFAULT_FOLDERS = {fleeting:'raw', literature:'_literature', permanent:'_permanent', wiki:'_wiki'}` (config.ts:44); embedded MCP `127.0.0.1:3334` (`MCP_DEFAULT_PORT`, index.ts:114); `rightPanel` union = `'none'|'graph'|'ai'|'backlinks'|'search'|'outline'|'tags'|'coach'|'synthesis'` (app-store.ts:42); `McpServerOptions.onToolCall` exists, **no `extraTools` yet** (server.ts:30–48); `NODE_CREATION_LIMIT=50` (agentic-graph.ts:13); `ingest()` sync (ingest-pipeline.ts:51), `indexFiles()` async (indexer/index.ts:144), `extractFileContent()` async (file-extractors.ts:31), local embedder `paraphrase-multilingual-MiniLM-L12-v2`.

---

## 1. Overview & Product Essence

Stellavault desktop becomes an **always-on, zero-friction second brain** that works *while* you work. You leave it open and use it as a normal `.md` notes app. Knowledge enters through three doors that all feed **one pipeline**:

- **Drag-and-drop** (files / URLs / text) anywhere on the window — it ingests, classifies, and files immediately.
- **MCP passive capture** — the embedded Agent Memory server (`127.0.0.1:3334`) lets LLM apps (Claude Code first; any MCP client next) **read AND write** knowledge as you work.
- **(Later) browser/clipboard clip** — same pipeline, new front door.

Captured content auto-organizes into **emergent categories** ("촤라락" — crisply cascading into labeled shelves), is **non-destructive** (only ever creates new notes; never moves/edits your existing files without confirmation), and is **retrievable on demand** (search / Ask / per-category Wiki synthesis) and **served back to LLM apps via MCP**. The classifier is **local-embedding-first** (no API key — the moat), with an optional LLM boost when a provider key is set.

---

## 2. Goals & Non-Goals

**Goals**
- One ingest+classify pipeline behind every capture door (drag, MCP, later clip).
- Confidence-gated **smart-auto**: high-confidence files silently; ambiguous → one-click **Review Queue**. Everything undoable, strictly non-destructive.
- **Emergent taxonomy** as default; user-defined and hybrid (seed + auto-expand) coexist and are selectable.
- Local-first classification that **always works** offline; LLM strictly optional/off-path.
- Fresh captures retrievable immediately (decay-seeded), so the AI write→read loop closes in-session.
- Reuse existing Stellavault machinery; add only the genuinely-missing funnel + classifier + UI.

**Non-Goals (this design)**
- A second indexing loop (we funnel into the existing watcher's `flush()` + `indexFiles` hash-skip).
- Browser extension / clipboard watcher (P3).
- Cloud sync / federation of captured text (stays off-by-default per v0.7.4 security baseline).
- Rewriting `ingest()` / extraction / search — reused wholesale.
- Auto-reorganizing a user's hand-built folder tree (categories are an additive *projection*, not a forced move — see `[RESOLVED-A]`).

---

## 3. The Three User Decisions (restated crisply)

1. **CAPTURE — MCP-passive + first-class in-app drop, one pipeline.** The embedded MCP server is the passive sink LLM apps read/write. A first-class in-app **drag-and-drop** (files AND links) makes the app fully usable **standalone**. Browser/clipboard is later. **Both paths feed the same `captureAndIndex()` funnel.**
2. **AUTOMATION — Smart-Auto (confidence-gated).** High-confidence → auto-classified, filed silently. Ambiguous/low-confidence → **Review Queue** for one-click confirm. Everything undoable; strictly non-destructive to existing vault files.
3. **TAXONOMY — Emergent default; user-defined + hybrid coexist.** AI-discovered categories (discover/label/merge/evolve) are the default. User-defined categories and hybrid (seed + auto-expand) are selectable and live in the same registry, distinguished by `origin`. **Classification engine is local-embedding-first; optional LLM boost when a key is configured.**

---

## 4. High-Level Architecture

```
   DOOR A: in-app DnD        DOOR B: MCP passive write      DOOR C (P3): browser/clipboard clip
   files / URLs / text       capture tool (3334)            url / text
        │                          │                              │
        ▼                          ▼                              ▼
   vault:capture (IPC) ──────► OrchestrationEngine.enqueue() ◄──── /clip path
                                    │
                          ┌─────────▼──────────────────────────────────────────┐
                          │  CAPTURE QUEUE  (persisted SQLite, serial, FIFO)    │  ← crash-safe, dedupe, audit
                          └─────────┬──────────────────────────────────────────┘
                                    │  (single worker, concurrency = 1, idle-tick paced)
        ┌───────────────────────────▼───────────────────────────────────────────────────┐
        │  1. NORMALIZE/EXTRACT   extractFileContent() | url-fetch+clip | youtube | text  │
        │  2. DEDUP               sha256(normalizedText)/canonURL → capture_hash hit? skip │
        │  3. INGEST              ingest(vaultPath, IngestInput, folders→00_Inbox) → .md   │  ← frontmatter+autotag+autolink
        │  4. CLASSIFY            classifyNote(emb, entities, rules, categories) → conf     │  ← local-first; LLM boost optional
        │  5. SMART-AUTO ROUTE    conf≥τ_auto → file silently │ else → Review Queue          │
        │  6. WRITE+INDEX         noteSelfWrite(); indexFiles([path]); bump caches          │  ← explicit immediate index
        │  7. SEED DECAY          decayEngine.recordAccess({type:'capture'})  (72h SLA)     │
        │  8. JOURNAL+EMIT        classify_journal row; capture:progress/done events        │
        └───────────────────────────┬───────────────────────────────────────────────────┘
                                    ▼
                     STORE: .md vault (authoritative) + derived SQLite index + categories table
                                    │
   ┌────────────────────────────────▼──────────────────────────────────────────────────────┐
   │  RETRIEVE / SERVE-BACK                                                                   │
   │  search · ask · per-category compileWiki · get-related · CategoryPanel · ReviewQueue     │
   │  served BACK via MCP: search / ask / capture / list-recent-captures / get-related-to     │
   └─────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                            [ LLM apps read ]  →  loop closes
```

**`[RESOLVED-Engine]` — the funnel IS the queue.** D1/D2/D3/D4 each call the funnel `captureAndIndex()` / `ingestClassifyIndex()` / `ingestAndIndex()`; D5 wraps the same work in a **persisted serial `OrchestrationEngine` queue**. These are unified: **the canonical entry point is `OrchestrationEngine.enqueue(req)` → persisted `capture_queue` → single worker → `runCapture()`**, where `runCapture()` is the body all five describe. D1's in-memory `p-queue(concurrency 2)` is **superseded by D5's persisted SQLite FIFO at concurrency 1** (crash-safety + `SQLITE_BUSY` avoidance + ordering for auto-link win over marginal throughput). The funnel name in this doc is **`runCapture()`**; `OrchestrationEngine.enqueue()` is the only thing IPC/MCP call.

---

## 5. End-to-End Data Flows (citing real APIs)

### 5.1 File drop (Door A, happy path)
1. **Renderer** `DropOverlay` `drop` → `File.arrayBuffer()` → IPC **`vault:capture`** `{kind:'file', fileName, base64,…}` (preload `ALLOWED_CHANNELS` gate).
2. **Main** stages bytes to `tmpdir()/sv-cap-*` (renderer never holds the path, so `extractFileContent(path)` is reused unchanged); `OrchestrationEngine.enqueue({kind:'file', payload:tmpPath, source:'drop'})`; returns `{id}`. `tmp` `unlink` in `finally`.
3. **Worker** dequeues → `capture_queue.status='processing'`.
4. **Size cap** `statSync(path).size > 50MB` → `rejected/size` (same cap as `extractFileContent` + multer route), before any read.
5. **Extract** `await extractFileContent(tmpPath)` (unpdf/mammoth/officeparser/xlsx; throw → utf-8 fallback → else `rejected/unsupported`).
6. **Dedup** `sha256(normalize(text))` → `capture_hash` hit → `{status:'duplicate', duplicateOf}`, no write.
7. **Original asset** copy verbatim to `_attachments/`; record `sv.capture.attachment`. *(D3 — kept; D1 omitted it. `[RESOLVED-B]`)*
8. **Ingest** `ingest(vaultPath, IngestInput, folders={fleeting:'00_Inbox',…})` → writes `.md` into `00_Inbox/`, frontmatter + `extractAutoTags` + `autoLink` + index codes.
9. **Classify** `classifyNote(ctx, categories, cfg)` → `{categoryId, confidence, method, alternatives}` (local nearest-centroid; LLM boost only in ambiguous band if key set).
10. **Smart-auto route** `conf ≥ τ_auto (0.78)` → write `sv.*` frontmatter, `safeMove()` 00_Inbox → stage folder (`classifyStage` decides root) + category leaf; else stay in `00_Inbox/`, `classify_journal` row `status='pending'` (= Review Queue).
11. **Index** `noteSelfWrite(absPath)` (echo-guard) → `await indexFiles(vaultPath, [absPath], {store, embedder, chunkOptions:coreChunkOptions})` → `bumpVaultFsVersion()` + `bumpGraphCacheVersion()`.
12. **Seed decay** `decayEngine.recordAccess({documentId: docIdForFile(vp,absPath), type:'capture'})` → 72h retrievability.
13. **Record** `capture_hash.put(hash, savedTo)`; `capture_queue.status='done'`.
14. **Emit** `capture:progress`→`capture:done` (renderer toast / Inbox badge). **Post-batch:** `compileWiki` fires **once, debounced 5s after queue drains** (collapses N→1).

### 5.2 URL drop (Door A)
1. `DropOverlay` reads `text/uri-list`/`text/plain` → IPC `vault:capture {kind:'url', url, html?, selection?}`.
2. Enqueue; worker: **YouTube?** `extractYouTubeContent()` + `formatYouTubeNote()` → `type:'youtube'`, stage `literature`. **Else** if browser supplied `html`/`selection` → use it (no fetch, **no SSRF surface**); else server-fetch guarded by `assertNotPrivateUrl()` (SSRF) + `AbortSignal.timeout(15000)` + `/clip` HTML→MD regex chain → `type:'url'`.
3. **URL dedup** keys on canonicalized URL (strip tracking params) → re-clip is a no-op. Then steps 8–14 as §5.1.

### 5.3 MCP write (Door B)
1. **LLM app** `tools/call "capture" {kind, content, title?, tags?, stageHint?}` to `127.0.0.1:3334`.
2. **Tool handler** validates (content required; text/url ≤ 50KB; file path absolute) + **rate-limit (100/hr/session)** + `recordMcpActivity({tool:'capture', detail: title|content.slice(0,80)})` (never full body).
3. `OrchestrationEngine.enqueue({kind, payload:content, source:'mcp:<client>'})` → returns **immediately** `{queued:true, id}` *(see `[RESOLVED-D]` for sync-vs-async return)*.
4. Worker runs the identical `runCapture()` (§5.1 steps 4–14).
5. Tool result (when resolved / polled) carries `{status, savedTo, stage, categories, confidence, decision, indexed}` so the agent can immediately `search`/`get-related` what it wrote (read-after-write consistency from the explicit `indexFiles`).

**`[RESOLVED-C]` — `create-knowledge-node`/`log-decision` get a post-write hook.** Both existing write tools enqueue their just-written path into the same pipeline tail (classify→index→decay), fixing their "appears only after manual reindex" gap. Backward-compatible (no signature change). `capture` is the new first-class write tool; the legacy two are routed through, not replaced.

---

## 6. Subsystem Designs (merged)

### 6.1 The funnel: `runCapture()` + `OrchestrationEngine` (main process)

```ts
// packages/desktop/src/main/orchestration/engine.ts  (NEW)
export type CaptureKind   = 'file' | 'url' | 'text';
export type CaptureSource = 'drop' | 'mcp' | 'clip';

export interface CaptureRequest {
  kind: CaptureKind;
  payload: string;            // file: tmp abs path | url: URL | text: raw md
  title?: string; tags?: string[];
  source: CaptureSource;
  sourceMeta?: { fileName?: string; mime?: string; client?: string; html?: string; selection?: string };
  stageHint?: 'fleeting' | 'literature' | 'permanent';
}
export interface CaptureOutcome {
  status: 'created' | 'duplicate' | 'queued' | 'rejected';
  savedTo?: string; documentId?: string; title?: string;
  stage?: 'fleeting'|'literature'|'permanent';
  categories?: string[]; confidence?: number; decision?: 'auto'|'review';
  duplicateOf?: string;
  reason?: 'engine-loading'|'size'|'unsupported'|'ssrf'|'no-vault'|'queue-full';
  indexed?: boolean;
}

export class OrchestrationEngine {
  start(): void;                                   // called in whenReady AFTER initCore resolves
  stop(): Promise<void>;                           // before-quit: finish current item, then halt
  setPaused(p: boolean): void;                     // "stop touching my vault" switch
  enqueue(req: CaptureRequest): { id: string };    // DB write only; returns immediately
  // internal: worker loop → runCapture(req, onProgress) → CaptureOutcome
}
```

`runCapture()` internals (every line reuses an existing symbol in `main/index.ts` scope unless marked NEW):

| Phase | Implementation |
|---|---|
| guard | `!coreReady || !store` → `rejected/engine-loading` (mirrors `publish:start`). Cold-start drops still **enqueue** (DB write); worker drains once core ready. |
| size cap | file >50MB / text >1MB / url field >2000 chars → `rejected/size` before read. |
| extract | file→`extractFileContent()`; url→youtube/clip/fetch+`assertNotPrivateUrl()`; text→passthrough. |
| asset | binary → copy original to `_attachments/`; set `sv.capture.attachment`. **[NEW wiring]** |
| dedup | `sha256(normalize(body))` (+canonURL) → `capture_hash`. Hit → `duplicate`, no write. Self-heal if `savedTo` gone. **[NEW table]** |
| ingest | `ingest(vaultPath, input, folders={fleeting:'00_Inbox',…})` (sync). |
| classify | `classifyNote(buildCtx(res, emb), loadCategories(store), cfg)` (async if LLM boost). **[NEW module]** |
| route | `auto` → frontmatter + `safeMove()` to stage/category folder; `review` → journal `pending`. **[NEW]** |
| index | `noteSelfWrite(abs)` → `await indexFiles(vp,[abs],{store,embedder,chunkOptions:coreChunkOptions})` → bump caches. |
| seed | `decayEngine.recordAccess({documentId, type:'capture'})`. |
| record | `capture_hash.put`; `capture_queue.status='done'`; emit events. |

**Concurrency/backpressure (`[RESOLVED-Engine]`):** serial worker (concurrency 1); idle-tick ~150ms when queue depth >20; `queue cap 5000` → `rejected/queue-full`; `compileWiki` debounced to **one fire 5s after drain**. On boot: `UPDATE capture_queue SET status='queued' WHERE status='processing'` (at-least-once; dedup makes re-runs safe).

### 6.2 Classification engine (`packages/core/src/intelligence/classify/`, NEW)

**`[RESOLVED-D2-location]`** — the classifier lives in **core** (D2/D3 placement), not desktop main (D5's `orchestration/classify.ts`). Rationale: core owns embeddings/entities/kMeans and must stay LLM/desktop-agnostic; the desktop engine *calls* it. D5's `classify.ts` is folded into this core module.

**Category model** (first-class persisted object with a centroid; supports all 3 taxonomy modes via `origin`):

```ts
export type CategoryOrigin = 'emergent' | 'user' | 'seed';
export interface Category {
  id: string;              // stable slug, never renumbered (unlike kMeans indices)
  label: string; origin: CategoryOrigin;
  centroid: Float32Array;  // dim = whatever embedder emits (MiniLM-L12 = 384, NOT 768)
  memberCount: number; keywords: string[];
  folder?: string; parentId?: string;
  rules?: CategoryRule[];  // deterministic overrides (origin user/seed), evaluated FIRST
  status: 'active'|'merged'|'archived'; mergedInto?: string;
  threshold?: number; pinned?: boolean;
  centroidVersion: number; createdAt: string; updatedAt: string;
}
export interface CategoryRule { kind:'tag'|'pathPrefix'|'sourceType'|'titleRegex'|'frontmatterKey'; value:string; }
```

**Classifier (pure function; precedence: rule → embedding nearest-centroid → optional LLM tie-break):**

```ts
function classifyNote(ctx: NoteCtx, cats: Category[], cfg: ClassifyConfig)
  : { categoryId: string|null; confidence: number; method:'rule'|'embedding'|'llm'|'manual'; alternatives: {id:string;sim:number}[] };
```
- **(A) Hard rules** → conf 1.0, `method:'rule'`, no embedding.
- **(B) Nearest centroid** — `dotProduct(normalizeVector(ctx.embedding), category.centroid)` over active categories → **k dot products** (k≈5–30), sub-ms. *Never re-clusters on the hot path.*
- **(C) Confidence** = `wFit·fit + wMargin·margin + lexBonus` where `fit = clamp01((sim_top − floor)/(1−floor))`, `margin = clamp01(gap_to_runnerup / marginScale)`, `lexBonus = lexWeight · jaccard(ctx.entities, top.keywords)`.
- **(D) LLM boost** — only when `cfg.llmEnabled && τ_review ≤ conf < τ_auto && synthesizer present`. **Clamped: an LLM may pick within top-N and raise conf to at most `τ_auto`** (never force-auto-files something the local signal called ambiguous — preserves local-first + human-in-loop).

**Config (parallels `resolveSearchWeights`, same trim/clamp env guard):**
```ts
classify: {
  tau: { auto: 0.78, review: 0.55 },   // [RESOLVED-E] thresholds unified (see below)
  simFloor: 0.30, marginScale: 0.15, lexWeight: 0.10, wFit: 0.6, wMargin: 0.4,
  topN: 3, taxonomyMode: 'emergent',   // 'emergent'|'user'|'hybrid'
  llmEnabled: false,                   // auto-true iff AI provider key present
  autoMoveScope: 'managed',            // 'managed'|'off'|'all'
}
// env: STELLAVAULT_CLASSIFY_TAU_AUTO / _TAU_REVIEW / _SIM_FLOOR (clamped [0,1])
```

**`[RESOLVED-E]` — confidence threshold reconciliation.** D1/D2 use `τ_auto=0.78/0.80`, `τ_review=0.55`, three-way gate; D3/D4/D5 use a single `0.75`/`0.80` cutoff. **Unified to D2's two-threshold three-way gate** (it's the most expressive and subsumes the single-cutoff designs): `≥τ_auto` silent-file; `[τ_review, τ_auto)` review-with-suggestions; `<τ_review` review-with-"+New category". Default `τ_auto = 0.78`. All thresholds config+env tunable; a user may set `τ_auto = 1.0` to "review everything."

**Three-way Smart-Auto gate:**

| Band | Condition | Action |
|---|---|---|
| AUTO | `conf ≥ τ_auto` AND category exists AND (rule OR margin>δ) | frontmatter + `safeMove()` (if `autoMoveScope` allows & note managed). Silent. Journaled. |
| REVIEW | `τ_review ≤ conf < τ_auto` | write `sv.category` **provisionally, no move** + enqueue with top-N. |
| REVIEW (cold/low-fit) | `conf < τ_review` OR no category | enqueue with top-N + **"＋ New category"** (label from entities). No category written. |

**Emergent discovery** (`discoverCategories()`, background, debounced, singleflight like `gap-cache.ts`): cluster **only the unowned set** (sim-to-all-centroids `< simFloor`) via existing `kMeans()` (`k = clamp(round(√(n/5)), 2, maxNewPerRun)`); label from aggregated `extractEntities()` (CJK-safe; better than "most-connected node title"); LLM 2–4-word label optional/cosmetic (slug stays local-derived & immutable). **Merge** (`centroid·centroid ≥ 0.92`, neither pinned) → alias via `mergedInto`, **no note rewrite**. **Split** = proposal-only (never silent move). **Evolve** = incremental Welford centroid `centroid += (v−centroid)/memberCount`, `centroidVersion++`.

**Stability (no re-churn — the backbone):** owned notes excluded from re-clustering; incremental centroids; stable slugs forever; **hysteresis** (reclassify only if `sim_new − sim_current ≥ switchMargin (0.12)` AND clears `τ_auto`); content-hash idempotency (skip unless `contentHash` changed); pinned/user/seed categories are anchors (never auto merge/split/rename).

**Feedback loop:** confirm/recategorize nudges centroid toward the note (`centroidVersion++`); dismiss records a soft negative raising that category's effective `simFloor`. Pure local online adjustment, no training. Confirms also `recordAccess('review')`.

### 6.3 Data model, vault layout & frontmatter (D3, authoritative)

**`[RESOLVED-A]` — categories are additive frontmatter by default, NOT folder moves.** Conflict: D2/D3/D4 say categorize-in-place (frontmatter) and never restructure existing folders; D1/D5 imply moving notes into category folders. **Resolution: two modes, frontmatter is always authoritative.**
- **`frontmatter` mode (DEFAULT):** category is only an `sv.category` YAML key; the note physically stays where the **stage** pipeline put it (`raw`/`_literature`/`_permanent`). `_categories/*.md` + the Category panel are navigation. Cleanest, Obsidian-Dataview-native, fully reversible.
- **`folder-mirror` mode (opt-in):** high-confidence notes are additionally `safeMove()`d into `Categories/<Name>/` for the literal "촤라락" visual. Frontmatter remains authority; folder is a rebuildable mirror.
- **In BOTH modes, pre-existing user-authored files (no `sv.ingest_id`) are classify-in-place only** (frontmatter tag, never moved) unless the user opts them in. `autoMoveScope='managed'` enforces this — auto-move is restricted to engine-ingested notes or notes already under managed roots (`00_Inbox/`, `raw/`, `_literature/`, `_permanent/`, `Clips/`).

**Vault layout** (extends `DEFAULT_FOLDERS`, all existing folders unchanged):
```
<vault>/
  00_Inbox/         # NEW — universal landing zone (every fresh capture lands here first)
  raw/ _literature/ _permanent/ _wiki/   # EXISTING (DEFAULT_FOLDERS) — untouched
  _attachments/     # NEW — original dropped binaries kept verbatim (linked via sv.capture.attachment)
  01_Knowledge/     # EXISTING — create-knowledge-node target (kept)
  _categories/      # NEW — one .md per category = the registry (itself indexed/Ask-able) + _index.md
  Categories/       # NEW — only populated in folder-mirror mode
  .stellavault/     # NEW — derived, git-ignorable, NON-authoritative (rebuildable):
                    #   review-queue.jsonl, classify-audit.jsonl, taxonomy.json (centroid cache)
```

**`[RESOLVED-F]` — review-queue persistence: SQLite, not JSONL.** D3/D4 propose `.stellavault/review-queue.jsonl`; D2/D5 propose a SQLite `classify_journal` table. **Resolution: SQLite `classify_journal` is authoritative** (atomic with the index DB, crash-safe, doubles as the audit trail mandated by project rules, and `safeMove()` writes its journal row *before* the FS op for crash-recovery). The `.stellavault/*.jsonl` files are demoted to **optional human-readable export/mirror**, never the source of truth. The queue is also reconstructable by scanning `sv.review.needed: true` frontmatter (vault-is-truth).

**Note frontmatter (existing keys unchanged; `sv.*` block added — namespaced for one-key "is-managed" check + trivial reversal):**
```yaml
# EXISTING (from buildStandardNote): title, type, source, input_type, zettel_id, tags, created, summary
sv:
  ingest_id: "01HX…ULID"            # presence = Stellavault-managed
  schema: 1
  category: "machine-learning"       # PRIMARY category slug → _categories/machine-learning.md
  categories: [ {slug, confidence, by} ]   # ranked multi-label
  category_origin: "emergent"        # emergent | user | seed
  classify: { confidence, method, model, stage_confidence, at, status }   # status: auto-filed|review-pending|confirmed|corrected
  capture: { via, agent, attachment, original_url }   # via: mcp|drop|clip|cli
  review: { needed, reason }
  history: [ {at, from, to, by} ]    # append-only correction log → feeds feedback loop
```
No store-schema change: `scanFrontmatter()` already parses arbitrary YAML and `Document.frontmatter` is stored, so `sv.category` is searchable/filterable as-is. Reversibility: `sv unmanage <note>` strips the `sv:` map (+ moves back in folder-mirror).

**Category registry note** (`_categories/<slug>.md`): `type: category`, `sv:{slug, origin, parent, children, aliases, member_count, centroid_ref, seed, status, merged_into}`. `aliases` feed the existing `buildAliasIndex()` so "머신러닝"/"ML" resolve to the category at search time with no new code. `taxonomy.json` is a pure centroid cache (rebuildable). **`[GAP-1]`:** the **`categories` SQLite table (D2)** and the **`_categories/*.md` registry (D3)** are two representations of the same objects — the table is the fast index, the `.md` files are the authoritative/portable/Ask-able form. The implementer must keep them in sync: `.md` frontmatter authoritative; table rebuilt on reindex; centroid cached in both `taxonomy.json` and the table BLOB. Flagged as an integration cost, not a blocker.

### 6.4 IPC surface (`packages/desktop/src/shared/ipc-types.ts` + preload `ALLOWED_CHANNELS`/`ALLOWED_EVENTS`)

**`[RESOLVED-G]` — single capture channel name.** D1 uses `vault:ingest-file/-url/-text`; D3/D4/D5 use `capture:ingest`. **Unified to one polymorphic channel `vault:capture`** taking a discriminated `CaptureRequest` (kind dispatches file/url/text). Fewer channels to allowlist; matches the "one pipeline" framing.

```ts
// Channels (request/response)
'vault:capture':          { args: [req: CaptureRequest]; result: { id: string } };
'capture:list':           { args: []; result: CaptureItem[] };          // current Inbox rows
'capture:set-paused':     { args: [paused: boolean]; result: void };

'review:list':            { args: []; result: ReviewItem[] };
'review:confirm':         { args: [id: string, categoryId: string, stage: NoteStage]; result: CaptureOutcome };
'review:accept-all':      { args: []; result: { confirmed: number } };
'review:skip':            { args: [id: string]; result: void };          // keeps note in Inbox, drops from queue
'review:undo':            { args: [id?: string]; result: void };         // pops session undo / trashes just-created note

'categories:list':        { args: [mode: 'emergent'|'user'|'hybrid']; result: CategoryTree };
'categories:create':      { args: [name: string, fromNotePath?: string]; result: { id: string } };
'categories:recategorize':{ args: [notePath: string, categoryId: string]; result: void };  // drag-to-move
'categories:name-cluster':{ args: [clusterId: string, name: string]; result: { id: string } };
'categories:merge-cluster':{ args: [clusterId: string, intoCategoryId: string]; result: void };

// Events (main → renderer; no polling)
'capture:progress':  { id: string; phase: 'queued'|'extracting'|'classifying'|'filed'|'review'|'error';
                       progress?: number; result?: { category: string; stage: string; confidence: number }; error?: string };
'capture:done':      CaptureOutcome & { id: string };
'capture:counts':    { capturedToday: number; pendingReviewCount: number; watching: boolean; queueDepth: number };
'review:changed':    { queueLength: number };
```
> **Security boundary (CRIT-02):** every channel added to `ALLOWED_CHANNELS`, every event to `ALLOWED_EVENTS`. `capture:*` payloads carry **titles/snippets only** in `result`, never full note text — consistent with the `McpActivity` "never full text" convention.

### 6.5 MCP surface (core, additive)

**`[RESOLVED-H]` — wiring via `extraTools` hook (D1), not direct registration in `server.ts` (D3).** Verified: `McpServerOptions` (server.ts:30) has `onToolCall` but **no `extraTools`**, and core must stay desktop-agnostic. So the capture tools are **injected by the desktop** (which owns `runCapture()` closing over `store/embedder/decayEngine/vaultPath`), not hard-coded into core's tool list. D3's "register in server.ts" is rejected for the *capture-write* tools (they need the desktop funnel) but **accepted for the pure-read tools** that only need `store`/`searchEngine` (those can live in core's list directly).

```ts
// core: McpServerOptions — additive, optional, back-compat (undefined → no change)
extraTools?: Array<{ name: string; description: string; inputSchema: object;
                     handler: (args: any) => Promise<{ content: {type:'text';text:string}[] }> }>;
// server.ts: spread into ListTools + dispatch switch default (same shape as agenticTools).

// desktop startMcpServer():
core.createMcpServer({ store, searchEngine, embedder, vaultPath, decayEngine,
  onToolCall: recordMcpActivity,
  corsOrigins: ['http://localhost','http://127.0.0.1'],
  extraTools: [ captureToolDef(engine.enqueue, recordMcpActivity),
                listRecentCapturesToolDef(store, decayEngine) ] });
```

| Tool | Type | Signature | Notes |
|---|---|---|---|
| `capture` | WRITE (new) | `{kind?:'text'\|'url'\|'file', content, title?, tags?, stageHint?}` | → `engine.enqueue()`. Idempotent (dedup). Rate-limit **100/hr** (above `create-knowledge-node`'s 50; passive capture is higher-volume but bounded). Returns `{status, savedTo, stage, categories, confidence, decision, indexed}`. |
| `list-recent-captures` | READ (new) | `{since?, category?, limit?}` | newest captures via `capture_hash`/`getDocumentsMeta()` + decay order. Closes "agent can't query what it just wrote." Title-only (cheap/private). |
| `get-related-to` | READ (new, thin) | `{text\|noteId}` | `store.findDocumentNeighbors()` + category boost — passive recall for in-loop use. |
| `list-categories` | READ (new) | `{}` | mirrors the panel: `_categories/*` registry (slug/label/member_count/parent) so agent can scope `search`/`ask`. |
| `create-knowledge-node`, `log-decision` | EXISTING | unchanged signatures | **post-write hook** enqueues their path into the pipeline tail (`[RESOLVED-C]`). |

**Serve-back contract:** results to LLMs stay lean (title + similarity + snippet + category + retrievability); full bodies only via explicit `get-document`. Every `search`/`get-document`/`get-related-to` auto-logs `recordAccess('mcp_query')` → AI usage tunes FSRS recency. Loopback-only + header API token + CORS allow-list (v0.7.4 baseline); federation off-by-default.

**`[RESOLVED-D]` — MCP capture returns async-queued, not synchronous outcome.** D1's `capture` handler `await`s `captureAndIndex` and returns the full outcome; D5's `capture-knowledge` returns `{queued:true,id}` immediately. **Resolution: enqueue returns `{queued:true, id}` immediately** (the serial persisted queue may have depth; blocking an agent on a 40-item backlog is wrong), **but** because most captures are singletons and the worker is fast, the tool handler **awaits up to a short budget (e.g. 3s)** for the worker to finish *this* item and, if done, returns the full `CaptureOutcome`; otherwise returns `{status:'queued', id}`. The agent gets read-after-write when the queue is shallow (the common case) and never hangs when it's deep. **`[OPEN-1]`** lists the await-budget value as a tunable.

### 6.6 Reuse map (every API verified in this codebase)
`ingest()`/`ingestBatch()` (ingest-pipeline.ts:51/143, **sync**), `extractFileContent()` (file-extractors.ts:31, async, 50MB cap), `extractYouTubeContent()`/`formatYouTubeNote()`, `indexFiles()` (indexer/index.ts:144, **async**, hash-skip), `compileWiki()` (wiki-compiler.ts:126), `autoLink()` (auto-linker.ts:133), `classifyStage()`/`extractAutoTags()` (inside `ingest`), `kMeans()`/`dotProduct`/`normalizeVector` (graph-data.ts + utils/math.ts), `store.getDocumentEmbeddings()`/`getDocumentsMeta()`/`findDocumentNeighbors()`/`getDb()`, `extractEntities()`/`buildAliasIndex()` (entity-extractor.ts), `decayEngine.recordAccess()`, `createMcpServer()`+`onToolCall`/`recordMcpActivity` (server.ts:30/48/100), `NODE_CREATION_LIMIT` pattern (agentic-graph.ts:13), watcher `flush()`/`noteSelfWrite()`/`isSelfWrite()`/`bumpVaultFsVersion()`/`bumpGraphCacheVersion()`/`docIdForFile()`/`toVaultRel()`, `assertInsideVault`/`sanitizeAssetName` (path-safety.ts), `gap-cache.ts` singleflight pattern, `createHash('sha256')` doc-id precedent. **Net-new only:** `OrchestrationEngine`+`capture_queue`+`capture_hash`, `classify/` core module + `categories`/`classify_journal` tables, `_categories/*.md` registry, `extraTools` hook, 4 MCP tools, 3 renderer panels + DropOverlay + OnboardingHost + StatusBar pill.

---

## 7. UI Surface

**New panels** (extend `rightPanel` union — verified current: `…|'coach'|'synthesis'`):
```ts
rightPanel: … | 'coach' | 'synthesis' | 'capture' | 'review' | 'categories';   // +3
```
- **`CapturePanel`** (`'capture'`) — Inbox + per-item progress (`queued→extracting→classifying→filed|review|error`), "JUST FILED" audit list (each row `[open][↩]` undoable), "+ Add files…" / "Paste link" (keyboard/no-drag entry), **Pause** (global `captureAutoFile` flag).
- **`ReviewQueuePanel`** (`'review'`) — confidence-gated cards: top-N category chips (#1 preselected) + "+New category…", stage radios, one-click **Confirm** (or `Enter`); keyboard loop (`1/2/3` pick, `Enter` confirm, `Esc`/`s` skip, `Del` trash); **"Accept all top"** (batched undo); `↩ Undo last`; empty state "🎉 Inbox zero."
- **`CategoryPanel`** (`'categories'`) — vault by category; **mode switch** Emergent/Defined/Hybrid (re-projects, never moves files); **drag-to-recategorize** (note → category header → `categories:recategorize`, undoable); **emerging unlabeled clusters** with `[name it…]`/`[merge]`/`[ignore]`; "N uncategorized" facet.

**Global overlay** — `DropOverlay.tsx`, mounted as a sibling of `<CaptureHost/>` in `App.tsx` root. **Coexistence (non-negotiable):** `pointer-events:none` until a drag carries `Files`/`text/uri-list` **and** is not internal (existing TabBar/FileTree DnD tag a sentinel `application/x-stellavault-internal`; overlay ignores those). So editor-image drops and FileTree moves keep working; only external drops onto chrome/empty/Inbox-zone are captured. Two zones while dragging: **📥 Inbox (classify)** default + **📂 …/folder (here)** (only when over a FileTree folder → bypass classify).

**Onboarding** — `OnboardingHost.tsx` (sibling of `CaptureHost`), 3-step skippable (gated on `settings.onboardingComplete`): (1) designate vault (prefilled; "never moves/edits your files without asking"); (2) **Local-only (default) vs +AI boost key**; (3) taxonomy mode (emergent default / defined / hybrid + seed suggestions) + optional one-click **"Connect Claude Code now"** (`mcp:start` + config snippet). Skip → editor with sane defaults.

**Always-on indicator** — one **capture pill** in `StatusBar` right cluster (before "AI ready"): `◉ {capturedToday} ⌁{MCP} ⚑{pendingReview}` (review badge hidden at 0; `⌁` pulses on new `recordMcpActivity`). Click → popover: Watching / MCP connected (:3334, N calls) / N captured today / M pending review / K categories / Pause auto-filing — each row opens the relevant panel. **This is the only always-visible footprint** (the "stays a notes app" guarantee).

**Commands + hotkeys** (idempotent registration like `registerStageCPanelCommands`; `mod+shift+i/r/c` verified free):

| id | title | hotkey | action |
|---|---|---|---|
| `panel.capture` | Open capture inbox | `mod+shift+i` | `setRightPanel('capture')` |
| `panel.review` | Open review queue | `mod+shift+r` | `setRightPanel('review')` |
| `panel.categories` | Open categories | `mod+shift+c` | `setRightPanel('categories')` |
| `capture.add-files` / `capture.paste-link` / `capture.toggle-pause` | — | — | picker / clipboard URL / toggle |
| `review.accept-all` | Accept all top | — | bulk confirm |
| `capture.onboarding` | Run setup again | — | reopen OnboardingHost |

**App-store state additions:** `captureWatching, capturedToday, pendingReviewCount, captureAutoFile, queueDepth, captureItems[], reviewQueue[], reviewUndoStack[], taxonomyMode, categoryView`; actions `setRightPanel` (widened), `pushCaptureItem/updateCaptureItem`, `enqueueReview/confirmReview/skipReview/undoReview`, `setTaxonomyMode`, `setCaptureAutoFile`. Persist in `AppSettings`: `onboardingComplete`, `taxonomyMode`, `captureAutoFileThreshold`, reuse existing `ai` slice for key + `mcpAutoStart`. **`[OPEN-2]`:** if capture state grows, split into a dedicated `capture-store.ts` (mirrors `decisions-store.ts`).

---

## 8. Phased Roadmap

### MVP — Standalone in-app capture (no MCP dependency)
**Scope:** `OrchestrationEngine` + persisted `capture_queue` + `capture_hash`; `DropOverlay` (files/URLs/text) → `vault:capture` → `runCapture()` (extract → local classify → confidence gate → smart-auto file OR Review Queue) → explicit `indexFiles`; `classify/` core module with emergent discovery (reuse `kMeans`, extractive labels) + `categories`/`classify_journal` tables; `_categories/*.md` registry; CapturePanel + ReviewQueuePanel + CategoryPanel + StatusBar pill + OnboardingHost. `frontmatter` mode default.
**Success criteria:** Drop 20 mixed files (PDF/DOCX/MD/URL) → all searchable within seconds; high-confidence land in sensible categories silently, ambiguous in Review Queue with top-3. UI never freezes on a 100-file drop (queue depth visible, drains steadily). One bad input (corrupt PDF / dead URL / 2GB file) → that item alone shows "failed," rest succeed. **Zero existing vault files modified or moved (verify by hash before/after).** Quit mid-drop → on relaunch unprocessed items resume, no dupes.

### P2 — MCP passive capture + serve-back
**Scope:** `extraTools` hook in core; `capture` + `list-recent-captures` + `get-related-to` + `list-categories` tools; post-write hook routing `create-knowledge-node`/`log-decision` through the tail; "Connect Claude Code" config writer (retarget `cli/mcp-clients.ts` to `http://127.0.0.1:3334/mcp`); per-source rate-limit; privacy indicator + opt-in gate (Agent Memory toggle).
**Success criteria:** With Claude Code connected + Agent Memory on, an LLM that calls `capture` during a task can `search`/`list-recent-captures` and retrieve it **in the same session** — accrual loop closes (content actually indexed, not "next reindex"). Capture visibly indicated + rate-limited; toggling Agent Memory off halts passive capture immediately. No raw captured text leaves loopback (verify: zero outbound from capture path).

### P3 — Browser/clipboard clip + taxonomy evolution
**Scope:** browser extension / clipboard watcher → same queue (`kind:url`/`text`); category merge/split/rename/auto-relabel; feedback-loop centroid refinement promoted to a scheduled "taxonomy maintenance" pass; LLM relabeling when key present; `folder-mirror` mode polish.
**Success criteria:** clip-from-browser uses identical pipeline + gating. After N user corrections, auto-file accuracy on a held-out set measurably improves; emergent categories merge duplicates + rename clearer without manual curation. Taxonomy maintenance never blocks capture, never mis-moves categorized notes without review.

---

## 9. Risk / Threat Register (per project Phase-6 Gate — all 5 questions)

| # | Threat | Vector | Mitigation |
|---|---|---|---|
| **1** | **Malicious/poisoned input** *(Critical → MVP)* | Prompt-injection in dropped HTML/MD; YAML-frontmatter injection; path-traversal filename `../../`; SSRF via `file://`/internal URL | Capture is **data, not instructions** — stored as note body, never concatenated into a system prompt; `ask` grounds on retrieved chunks. Frontmatter built by `ingest()` (sanitizes YAML). Filenames slugified; writes confined under `vaultPath` via `assertInsideVault` (reject escapes). URLs: `assertNotPrivateUrl()` blocks private/loopback/link-local + `file:`/`gopher:`. Executables/oversized rejected pre-queue (extension + 50MB cap). |
| **2** | **DoS by mass-drop** *(Medium → MVP throttle, P2 refine)* | 10k-file drop / fork-bomb folder; MCP client hammers `capture` | **Serial worker + idle-tick (~150ms)** bounds CPU/IO regardless of input. **Queue cap 5000** → `rejected/queue-full`. **Per-source token bucket** on MCP tool (100/hr, mirrors `NODE_CREATION_LIMIT`). `compileWiki` debounced to **once** post-drain. Watcher re-entrancy guard prevents flush pile-up. Net: a 10k drop *drains steadily*, never freezes or corrupts the index. |
| **3** | **Privacy of captured AI content** *(Medium → enforced P2)* | Passive MCP capture silently records sensitive content; captured note published; embeddings leak via federation | Passive capture **opt-in** (Agent Memory toggle, default off) + **loopback-only**. Visible always-on indicator + live activity feed → capture **never invisible**. Notes land in local vault only; **publish/federation off-by-default** (v0.7.4). `recordMcpActivity` gets `≤80 chars`, never full body. Per-source "exclude" + review-before-file for MCP writes give a consent gate. No raw text leaves the machine. |
| **4** | **Trust/integrity of auto-filing** *(Medium → MVP gate, P2 refine)* | Confidence gate misfires, silently buries a note wrong | **Conservative `τ_auto=0.78`** — ambiguous → Review Queue, never silent misfile. **Every auto-file journaled** (`classify_journal`: category, score, method, alternatives) and **reversible** (original untouched; recategorize = move, not rewrite). Rule matches (deterministic intent) override fuzzy. Feedback loop self-corrects. User can set `τ_auto=1.0` → "review everything." LLM clamped (can't auto-file what local called ambiguous). |
| **5** | **Data corruption/loss (cardinal: never corrupt existing files)** *(Critical → MVP)* | Engine overwrites a user note; partial write on crash; same-name clobber; concurrent write vs user editing | Engine **only CREATES new notes** (00_Inbox / category folders) with timestamped/uniqued names (collision → suffix); **never edits/moves pre-existing user files** without Review-Queue confirm (`autoMoveScope='managed'`). **`safeMove()`**: refuses to overwrite, **writes journal row BEFORE FS op** (crash-detectable/reversible), confined to `vaultPath`. Atomic write (temp→rename). Source files dropped in are **copied** to tmp, never moved/deleted from origin. Queue persistence + dedup hash → crash mid-batch re-runs safely, no dupes. Watcher echo-guard (`noteSelfWrite` 1500ms) prevents the engine's own writes racing the indexer. |

**Engineering risks (beyond threat model):** embedding latency = main-process jank on huge batches → serial queue smooths it; escape hatch is `utilityProcess` for the embedder (queue boundary makes it a local change, not MVP). kMeans cost (30s+ on 11k docs) → single-note classify is just cosine-vs-centroids (O(categories)); full re-cluster only on idle/post-batch/debounced, never hot-path. Two index paths drifting → engine + watcher share `noteSelfWrite`/`indexFiles`/`coreChunkOptions`; engine suppresses watcher only for files it indexes itself. Review queue graveyard → tune `τ_auto` so majority auto-files; surface count in pill; **`[OPEN-3]`** optional aging auto-file at lower bar after grace period.

---

## 10. Open Decisions for the User

- **`[OPEN-A]` Default routing mode.** `frontmatter` (categories as YAML, no file moves — recommended default, max-reversible) vs `folder-mirror` (literal "촤라락" folder cascade) as the out-of-box default. *Architect recommendation: ship `frontmatter` default, `folder-mirror` opt-in via onboarding/settings.*
- **`[OPEN-B]` `τ_auto` default.** `0.78` (architect/D2) balances silent-file rate vs review burden. Lower → more silent (more frictionless, more risk); higher → more review (safer, more clicks). Confirm the shipped default.
- **`[OPEN-C]` MCP capture rate-limit.** `100/hr/session` (above `create-knowledge-node`'s 50). Confirm, given passive capture is higher-volume than manual node creation.
- **`[OPEN-1]` MCP `capture` await-budget** (`[RESOLVED-D]`): how long the tool handler waits for the worker before returning `queued` (proposed ~3s). Affects read-after-write feel vs agent latency.
- **`[OPEN-D]` `_categories` table vs `.md` sync** (`[GAP-1]`): accept the dual-representation integration cost (fast SQLite index + portable `.md` registry kept in sync), or pick one as sole authority. *Architect recommendation: keep both, `.md` authoritative, table rebuilt on reindex.*
- **`[OPEN-E]` Existing-vault first-run.** On first index of a populated vault: classify existing notes **metadata-only** (label, never move — recommended) — confirm this is the desired "see my vault labeled without anything moving" behavior, with per-category opt-in filing afterward.
- **`[OPEN-3]` Review-queue aging.** Allow stale review items to auto-file at a lower bar after a configurable grace period (off by default)?

---

### Conflicts resolved (summary index)
`[RESOLVED-A]` categories = additive frontmatter default, folder-mirror opt-in (D2/D3/D4 over D1/D5 implied moves) · `[RESOLVED-B]` keep `_attachments/` original-binary copy (D3) · `[RESOLVED-C]` `create-knowledge-node`/`log-decision` get post-write hook, not replaced · `[RESOLVED-D]` MCP capture enqueues + short await-budget (hybrid of D1 sync / D5 async) · `[RESOLVED-E]` two-threshold three-way gate, `τ_auto=0.78` (D1/D2 over D3/D4/D5 single-cutoff) · `[RESOLVED-Engine]` D5 persisted serial queue supersedes D1 in-memory p-queue · `[RESOLVED-F]` SQLite `classify_journal` authoritative, JSONL demoted to export (D2/D5 over D3/D4) · `[RESOLVED-G]` one `vault:capture` channel (over D1's three) · `[RESOLVED-H]` capture-write tools via `extraTools` injection (D1), pure-read tools may register in core (D3) · `[RESOLVED-D2-location]` classifier in core, not desktop main. **Gaps:** `[GAP-1]` categories table↔`.md` sync cost. **Dimension fix to land:** `Chunk.embedding` comment says 768 but MiniLM-L12 emits **384** — design is dimension-agnostic, fix the stale comment.

---

### Key absolute paths for the implementer
- Funnel/engine (NEW): `packages/desktop/src/main/orchestration/engine.ts`
- Classifier (NEW): `packages/core/src/intelligence/classify/` (types.ts, classify.ts, discover.ts, safe-move.ts, dao.ts)
- Reused core: `packages/core/src/intelligence/ingest-pipeline.ts` (ingest:51), `indexer/index.ts` (indexFiles:144), `intelligence/file-extractors.ts` (:31), `intelligence/wiki-compiler.ts` (:126), `intelligence/auto-linker.ts` (:133), `api/graph-data.ts` (kMeans), `indexer/entity-extractor.ts`, `mcp/server.ts` (McpServerOptions:30, onToolCall:48), `mcp/tools/agentic-graph.ts` (NODE_CREATION_LIMIT:13), `config.ts` (DEFAULT_FOLDERS:44)
- Desktop wiring: `packages/desktop/src/main/index.ts` (MCP_DEFAULT_PORT:114, watcher/echo-guard/startMcpServer), `renderer/stores/app-store.ts` (rightPanel:42), `renderer/App.tsx`, `renderer/lib/commands.ts`, `shared/ipc-types.ts`, `main/path-safety.ts`
- New renderer: `renderer/components/layout/DropOverlay.tsx`, `components/panels/{CapturePanel,ReviewQueuePanel,CategoryPanel}.tsx`, `components/onboarding/OnboardingHost.tsx`, StatusBar pill edit
