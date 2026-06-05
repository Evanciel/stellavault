# Changelog

## [0.8.0] - 2026-06-05

### Added
- **Weighted RRF + FSRS recency ranking (B3)** — hybrid search now supports per-signal weights (`score(d)=Σ wᵢ·1/(k+rankᵢ)`; defaults semantic 1.0 / BM25 1.0 / entity 0.5) and a bounded post-fusion recency multiplier driven by the existing FSRS retrievability (`final = rrf·(1 + w·(R−0.5))`, default ±10%, centered at R=0.5). Config knobs `search.weights.*` / `search.recencyWeight` + env overrides `STELLAVAULT_W_SEMANTIC|BM25|ENTITY` / `STELLAVAULT_RECENCY_WEIGHT` (finite/range-guarded). Backward compatible — `rrfFusionN` gains an optional options arg; all existing callers and 27 core test suites pass unmodified. Design: `docs/02-design/b3-weighted-rrf-recency.md`.
- **One-command MCP setup** (`stellavault setup`) — auto-detects and writes MCP config for 5 clients: Claude Code (via `claude mcp add -s user`), Claude Desktop, Cursor, Windsurf, and VS Code. Flags: `-c/--client <id>` (repeatable), `--all`, `--command`, `--args`. Idempotent, non-destructive JSON merge (VS Code uses `servers` + `type:"stdio"`). Adds `SKILL.md` for assistant onboarding.
- **Entity-linking search signal** — entity extractor (wikilinks `[[…]]`, `#tags`, headings, title, Title-Case / ALL-CAPS fallback; Korean supported; cap 30/chunk) + new `chunk_entities` table (FK `ON DELETE CASCADE`). Entity match added as a 3rd RRF signal alongside semantic + keyword.
- **Adaptive reranking wired into MCP** — the MCP `search` tool now emits the adaptively reranked ordering.
- **4-stage upgrade** — `STELLAVAULT_DB_PATH`-respecting DB path resolution (env → `config.dbPath` → vault-hash fallback), decay index, chokidar watcher hook (auto incremental reindex while `serve` runs; `STELLAVAULT_WATCH=0` to disable), and a generation-bound gap-detection cache.

### Changed
- MCP `search` result ordering improved (weighted RRF + adaptive rerank). Result shape unchanged — callers are unaffected.

### Fixed
- Gap-cache stale-return race under concurrent calls — generation-bound inflight + db-keyed singleflight.
- Search→decay access recording (handleSearch array shape + missing documentId) — was dead since introduced.
- `resolveSearchWeights` empty-env guard: `Number('')===0` no longer zeroes weights when env vars are unset.

### Housekeeping
- `.gitignore`: PowerShell `ModuleAnalysisCache` artifact.

### Notes
- **Real vaults must be reindexed** for the entity signal to populate `chunk_entities`. A **full rebuild** is required to backfill entities onto pre-existing (unchanged) notes; an incremental reindex only extracts entities for changed/new files. See `docs/02-design/execution-runbook.md`.

### Tests
- `@stellavault/core`: 206 → **236** PASS (entity-extractor, entity-search, rrf-weighted, search-recency, config-weights suites).
- `tests/smoke.mjs`: **12** files / ALL PASS.

### Commits
`8a5ff6f` `94e718c` `fb29248` `d5931de` `bcebfa1` `dc0b06c`

## [0.7.4] - 2026-05-13

### Security (codex review sweep — SECURITY score 3/10 → 8/10)

Three rounds of independent review by OpenAI codex CLI, plus a self-review.
Every critical (P1) and high (P2) finding is fixed.

#### Critical
- **ESM `require('node:crypto'|'node:path')` removed** — `packages/core/src/api/routes/ingest.ts`, `packages/core/src/mcp/tools/agentic-graph.ts`. Would crash on stricter runtimes.
- **MCP HTTP wildcard CORS** → `corsOrigins` allow-list (`packages/core/src/mcp/server.ts`). Default: `localhost` + `127.0.0.1` (any port). Pass `['*']` to opt back in.
- **REST token hardening** (`packages/core/src/api/server.ts`)
  - `req.query.token` fallback removed — header (`X-Stellavault-Token`) only.
  - `/api/token` now refuses requests without a same-origin browser Origin header, so a hostile local process can no longer scrape the token.
- **Federation Ed25519 + signed protocol** — full rewrite of `packages/core/src/federation/{identity,node,types}.ts`:
  - Real Ed25519 keypair. `verifySignature(publicKey, message, signature)` no longer requires the secret key.
  - Wire format v2.1 — every envelope carries `{ payload, peerId, nonce, publicKeyHex?, signature }`; signature covers the entire envelope minus the signature itself.
  - Mutual challenge-response handshake binds `peerId` to `publicKey` before any message is accepted.
  - Per-envelope replay nonce defends against post-handshake message replay; HELLO nonce defends the handshake.
  - 30s handshake timeout drops connections that never complete the handshake.
  - Per-peer token bucket (50 rps / 100 burst) rate-limits inbound envelopes before signature work.
  - Recursive canonical JSON for signing — nested objects hash identically across runtimes.
  - v1 identity files (`identity.json` without `version`) are auto-backed-up to `identity.v1.bak.json` and replaced with a fresh Ed25519 key.

#### High
- **Federation REST mutations require auth** — `POST /api/federate/{join,leave}` now goes through `requireAuth`. `/status` stays public for the graph UI badge.
- **Sharing defaults are safe** — `DEFAULT_CONFIG.myNodeLevel: 2 → 0` (receive-only) and `defaultLevel: 2 → 1` (titles + similarity, no snippets). `FederatedSearch.startResponder` short-circuits to empty results until the operator opts in with `set-level 1+`. The CLI surfaces the current sharing level on `federate join`.
- **`search_request` peerId attribution** — emit now uses the handshake-verified `state.peerId` instead of `msg.queryId` (carried over from v1). No behaviour change for the bundled responder, but future audit/trust/rate consumers receive the right peer id.

#### Ship gate
- **`STELLAVAULT_FEDERATION_EXPERIMENTAL` toggle** — federation is off-by-default. The REST `POST /api/federate/join` returns `503 federation-experimental-disabled` and the CLI exits with code 2 unless the env var is set to a truthy value (`1`/`true`/`yes`/`on`, case-insensitive).

### Tests
- `packages/core/tests/federation-identity.test.ts` (+11 cases)
- `packages/core/tests/federation-protocol.test.ts` (+10 cases — handshake, replay, timeout, rate limit, peerId attribution)
- `packages/core/tests/federation-experimental-toggle.test.ts` (+4 cases)
- Suite: **192 → 206 PASS**. `tests/smoke.mjs` 11/11 unchanged.

### Breaking
- **Federation v2.0 wire format incompatible** — v0.7.3 federation nodes cannot peer with v0.7.4. Federation has had zero production users to date, so no migration path is shipped.
- **Identity file v1 auto-migrated** — old `~/.stellavault/federation/identity.json` is backed up to `identity.v1.bak.json`; a new Ed25519 key is minted on first use. Existing peers will need to re-pair.

### Housekeeping
- `.gitignore` hardened — `*.bak`, `*.bak.*`, `.autopilot-state.json`, `.context/`.
- `.autopilot-state.json` is no longer tracked (per-machine runtime state).
- `demo/explore.html` and `docs/LAZY_INIT_MCP_SPEC.md` brought under version control.

### Commits
`0c2a9ee` `88626b5` `18ed93e` `cb7bde8` `3f32225` `fa277cc` `aad45e4`

## [0.7.3] - 2026-04-14

### Performance
- **Graph HNSW** — sqlite-vec KNN for vaults with 200+ documents: O(n²) → O(n·K·log n)
  - Auto-selects: brute-force for small vaults, HNSW for large ones
  - New `findDocumentNeighbors()` store method using MATCH query
- **Math utils exported** — `cosineSimilarity`, `dotProduct`, `normalizeVector`, `euclideanDist` available from `@stellavault/core`

## [0.7.2] - 2026-04-14

### Architecture
- **server.ts -55%** — 1,374→620 lines. 6 route modules: federation, knowledge, ingest, profile-card, health, analytics
- **CLI shell completion** — `stellavault completion --shell bash|zsh|fish` (33 commands)

### Performance
- **Graph edge-key O(1)** — direct index comparison instead of indexOf
- **Server lazy imports** — gap-detector/duplicate-detector loaded on-demand
- **Upper-triangle graph** — 50% fewer similarity comparisons

### Tooling
- **Stress test** — `node tests/stress.mjs 1000` (1K docs: 346ms total)

## [0.7.1] - 2026-04-13

### Performance
- **Graph building 50% faster** — upper-triangle dot product (skip symmetric pairs)
- **Pre-normalized vectors** — cosine similarity → single dot product per pair
- **O(n) K-Means** — typed array centroid accumulation (was O(k*n) with allocations)
- **Batched embeddings** — 500/batch pagination prevents RAM overflow on large vaults
- **O(1) edge keys** — direct index comparison instead of indexOf/sort
- **Lazy imports** — detectDuplicates/detectKnowledgeGaps loaded on-demand
- **Shared math utils** — deduplicated cosineSimilarity/euclideanDist into utils/math.ts

### Tooling
- **Stress test** — `node tests/stress.mjs 500` benchmarks store, search, vector math
- **README benchmarks** — performance table with 100/500/1000 doc results

## [0.7.0] - 2026-04-13

### Architecture Evolution (5 iterations, 16 hypotheses validated)
- **Modular API** — `server.ts` split into 3 route modules: `routes/federation.ts`, `routes/knowledge.ts`, `routes/ingest.ts` (1,374→852 lines, -38%)
- **Type Safety** — Core `:any` reduced from 87→34 (-61%), CLI `:any` completely eliminated (20→0)
  - Typed DB rows in sqlite-vec, decay-engine, gap-detector
  - Typed Hyperswarm interfaces in federation/node.ts
  - Typed SQL query results throughout
- **Runtime Hardening** — O(1) sliding-window rate limiter with auto-cleanup, graph cache with 5-min TTL, silent catch blocks eliminated
- **MCP Tool Hardening** — Input size limits (2KB) on ask/generate-draft, rate limiting (50/hr) on create-knowledge-node, title/content validation
- **Test Coverage** — 127→168 tests (+41), MCP tool coverage 22%→100% (18/18 tools tested)
- **CLI Type System** — Shared `CliCommand` type, typed digest/federate/learn command handlers

### Zero-Any Files (8 critical modules)
`server.ts`, `sqlite-vec.ts`, `decay-engine.ts`, `gap-detector.ts`, `federation/node.ts`, `federation/search.ts`, `marketplace.ts`, CLI (all 8 files)

### Demo Vault
- `examples/demo-vault/` — 10 sample notes for instant `npx stellavault` experience

## [0.4.2] - 2026-04-07

### Features — Karpathy Architecture Complete
- **Session Hooks** — `stellavault session-save`: auto-capture session summaries to daily logs
  - Pipe via stdin or --summary flag
  - Creates `raw/_daily-logs/daily-log-YYYY-MM-DD.md`
  - Auto-compiles wiki after save
  - Works with Claude Code hooks (PreCompact, Stop)
- **Flush Process** — `stellavault flush`: daily logs → wiki compilation
  - Extracts concepts and connections from all daily logs
  - Rebuilds wiki index with backlinks
  - Karpathy's "source code → executable" compilation
- **Wikilink Auto-Connect** — Auto-insert [[wikilinks]] matching existing note titles on ingest
- **Hooks Setup Guide** — `docs/hooks-setup.md` with Claude Code settings.json config

### The Compounding Loop
```
Session → session-save → daily-log → flush → wiki
  ↑                                            ↓
  └── Claude reads wiki via MCP for better answers ←┘
```

## [0.4.1] - 2026-04-07

### Features
- **Binary File Ingest** — PDF (unpdf), DOCX (mammoth), PPTX (officeparser), XLSX (SheetJS) text extraction
- **Auto Pipeline** — `ingest` now auto-runs `compile` → wiki generated automatically
- **Web File Upload** — Drag & drop files in browser (POST /api/ingest/file, 50MB limit)
- **Mobile/PWA** — Responsive IngestPanel, service worker registration, installable as app
- **Express: stellavault draft** — Generate blog/report/outline from vault knowledge
- **MCP generate-draft** — 20th MCP tool: Claude writes drafts using vault context (free in Claude Code)
- **CLI --ai flag** — `stellavault draft --ai` uses Claude API for full AI-generated drafts
- **Configurable folders** — Override raw/_wiki/_literature/ in .stellavault.json
- **Multilingual embeddings** — paraphrase-multilingual-MiniLM-L12-v2 (50+ languages)

### Changes
- Binary files default to fleeting stage (Zettelkasten principle: all inputs start as fleeting)
- Repositioned as "Self-compiling knowledge MCP server"
- .npmignore excludes PDF (was 16MB in npm package)
- MCP tools: 19 → 20

### Fixes
- CLI YouTube ingest now properly calls extractYouTubeContent
- officeparser type cast fix (OfficeParserAST → string)
- unpdf text array handling (pages returned as array, not string)

## [0.4.0] - 2026-04-06

### Features
- **i18n Global Service** — Full EN/KO/JA/ZH language switcher for web UI; saved notes follow user's language setting
- **Web UI Ingest Panel** — Add knowledge from browser (+) button, no terminal needed
- **YouTube Deep Extraction** — Full description, transcript with clickable timestamps, auto-summary, metadata (channel, views, duration)
- **YouTube Transcript via yt-dlp** — Fallback to yt-dlp when YouTube bot protection blocks direct caption fetch
- **Edit/Delete Notes from Web** — Edit and delete notes directly from web UI, syncs to Obsidian vault
- **Ask Q&A Web UI** — Intelligence > Ask tab for querying your knowledge base from the browser
- **Reindex from Web** — One-click reindex button, no terminal needed
- **Recent Saves Navigation** — Click recent saves to navigate to node in 3D graph
- **Auto-index after Ingest** — New notes are automatically indexed and graph refreshes
- **Onboarding Guide** — 4-step walkthrough for new users
- **LLM Knowledge Base** — `stellavault ask` (Q&A + auto-filing), `compile` (raw→wiki), `lint` (health check), `digest --visual` (Mermaid charts)
- **Zettelkasten System** — Luhmann-style index codes, frontmatter scan, inbox zero, atomicity verification, orphan/broken link detection
- **Unified Ingest Pipeline** — URL/file/text auto-classification, `stellavault ingest`, `promote`, `autopilot` flywheel
- **Fleeting Capture** — `stellavault fleeting` for quick thoughts

### Fixes
- YouTube extractor v2 — HTML entities, tags cleanup, summary quality, duplicate frontmatter removal
- YouTube full description extraction (shortDescription JSON parsing)
- CLI YouTube ingest now properly calls extractYouTubeContent instead of basic HTML scrape
- Strict node matching — exact title/path only, no partial match
- React hooks order in Layout, ConstellationView, MultiverseView
- Natural Korean translations (감쇠→잊고 있는 것, 갭→빠진 지식)
- Reindex API — pass vaultPath, use all-MiniLM-L6-v2, error details

### Security
- Path traversal protection (archiveFile, ingest)
- YAML injection prevention (sanitizeYaml)
- SSRF protection (private IP blocking)
- Empty catch blocks → proper error logging

### Infrastructure
- MCP: 19 tools | CLI: 36+ commands | Tests: 127 ALL PASS
- Hardcoded Korean removed — core modules default to English
- Subpath exports for youtube-extractor module

## [0.3.0] - 2026-04-04

### Features
- 3D Knowledge Graph with Three.js / React Three Fiber
- Hybrid search (vector + keyword + RRF)
- Memory decay tracking (FSRS algorithm)
- MCP server with 16 tools
- Notion ↔ Obsidian sync (packages/sync)
- Web UI with constellation/multiverse views

## [0.2.0] - 2026-04-03

- Initial Obsidian vault indexer
- Vector store with all-MiniLM-L6-v2
- Basic CLI commands

## [0.1.0] - 2026-04-02

- Project inception
- Notion-Obsidian sync tool
