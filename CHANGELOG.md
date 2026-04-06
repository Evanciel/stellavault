# Changelog

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
