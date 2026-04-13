# Changelog

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
