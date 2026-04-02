# Stellavault

> Turn your Obsidian vault into a 3D neural knowledge graph with AI-powered search, memory decay tracking, and MCP integration.

## Features

- **3D Knowledge Graph** — React Three Fiber based interactive neural network visualization
- **Constellation View** — MST-based star map with 3-level LOD zoom
- **Hybrid Search** — BM25 + Cosine Similarity + RRF fusion for high-quality results
- **FSRS Memory Decay** — Spaced repetition tracking shows which knowledge is fading
- **Intelligence Panel** — Gap detection, duplicate finder, health dashboard, web clipper
- **Timeline Slider** — Filter notes by date range with histogram visualization
- **Type/Source Filter** — Filter by note type (note, clip, bridge) and source (local, notion)
- **Search History** — Recent searches saved locally with quick-access dropdown
- **MCP Server** — 10+ tools for Claude Code and other AI agents to access your knowledge
- **Knowledge Pack** — `.sv-pack` format for portable knowledge export/import with PII masking
- **Motion Control** — MediaPipe hand gesture control for 3D graph
- **Export** — Screenshot (PNG) and recording (WebM) with watermark
- **Dark/Light Mode** — Space theme (Dark) + clean blueprint theme (Light)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Index your Obsidian vault
npx stellavault index /path/to/your/obsidian/vault

# 3. Launch 3D graph
npx stellavault graph
# Opens http://localhost:5173 in your browser
```

You can also use the short alias `sv`:
```bash
npx sv index /path/to/vault
npx sv graph
```

## Architecture

```
stellavault/
├── packages/
│   ├── core/       Vector search engine + MCP server + REST API
│   ├── cli/        CLI commands (15 commands)
│   ├── graph/      3D Knowledge Graph (React Three Fiber)
│   └── sync/       Notion-Obsidian sync
├── scripts/
│   └── api-only.mjs   Standalone API server
├── LICENSE            MIT
└── CONTRIBUTING.md    Contributing guide
```

## CLI Commands

```bash
stellavault index <vault-path>    # Index Obsidian vault (vectorize + chunk + embed)
stellavault search <query>        # Search from terminal
stellavault graph                 # Launch 3D graph + API server
stellavault serve                 # Start MCP server (stdio)
stellavault status                # Index stats
stellavault decay                 # Memory decay health report
stellavault brief                 # Daily briefing (decay + gaps + activity)
stellavault digest                # Weekly activity report
stellavault review                # Daily review session (FSRS-based)
stellavault gaps                  # Knowledge gap detection
stellavault duplicates            # Duplicate note detection
stellavault clip <url>            # Clip web page / YouTube to vault
stellavault sync                  # Notion → Obsidian sync
stellavault card                  # Generate SVG profile card
stellavault pack create|export|import|list|info   # Knowledge Pack management
```

## MCP Integration

```bash
claude mcp add stellavault -- npx stellavault serve
```

| # | Tool | Description |
|---|------|-------------|
| 1 | `search` | RRF hybrid search |
| 2 | `get-document` | Full document retrieval |
| 3 | `list-topics` | Topic cloud |
| 4 | `get-related` | Related document discovery |
| 5 | `generate-claude-md` | Auto-generate CLAUDE.md |
| 6 | `create-snapshot` | Context snapshot |
| 7 | `load-snapshot` | Restore snapshot |
| 8 | `log-decision` | Record technical decisions |
| 9 | `find-decisions` | Search decisions |
| 10 | `export` | Export knowledge (JSON/CSV) |
| 11 | `get-decay-status` | Memory decay report |
| 12 | `get-morning-brief` | Daily knowledge briefing |

## Tech Stack

- **Runtime**: Node.js 20+ (ESM)
- **Language**: TypeScript (strict mode)
- **Vector Store**: SQLite-vec (better-sqlite3)
- **Embedding**: all-MiniLM-L6-v2 (384d, local inference)
- **Search**: BM25 + Cosine Similarity + RRF Fusion (K=60)
- **3D**: React Three Fiber + drei + Three.js
- **State**: Zustand
- **Testing**: Vitest
- **MCP**: @modelcontextprotocol/sdk

## Configuration

Create `.stellavault.json` in your project root or home directory:

```json
{
  "vaultPath": "/path/to/obsidian/vault",
  "dbPath": "~/.stellavault/index.db",
  "embedding": { "model": "local", "localModel": "all-MiniLM-L6-v2" },
  "search": { "defaultLimit": 10, "rrfK": 60 },
  "mcp": { "mode": "stdio", "port": 3333 }
}
```

## License

MIT
