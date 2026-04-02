# Stellavault

> **Notes die in folders. Stellavault keeps your knowledge alive.**

Your notes are not just files. They form a living network — connections emerge, memories fade, gaps appear. Stellavault turns your Obsidian vault into a knowledge system that **discovers hidden connections**, **detects fading memories**, **finds blind spots**, and **gives AI agents direct access to everything you know**.

## Why Stellavault?

| Problem | Stellavault |
|---------|-------------|
| Notes pile up, connections stay invisible | **Auto-discovers** semantic links between notes and visualizes them in 3D |
| You forget what you wrote 3 months ago | **FSRS decay engine** tracks retrievability and alerts before knowledge fades |
| Knowledge gaps hide in plain sight | **Gap detector** finds missing bridges between topic clusters |
| Duplicate ideas scattered across files | **Duplicate finder** catches semantic overlaps you'd never spot manually |
| AI assistants can't access your knowledge | **MCP server** lets Claude and other agents search, reason over, and learn from your vault |
| No way to see the big picture | **3D neural graph** with constellation view, timeline slider, and type filters |

## What It Actually Does

**1. Understands your knowledge** — Vectorizes every note with local embeddings (all-MiniLM-L6-v2), chunks intelligently, builds a semantic similarity graph with K-means clustering.

**2. Keeps it alive** — FSRS spaced repetition algorithm tracks how well you remember each piece of knowledge. Retrievability decays over time. Stellavault tells you what's fading and when to review.

**3. Finds what's missing** — Gap detector identifies weak connections between topic clusters. Duplicate detector catches redundant notes. Health dashboard gives you a full picture of your knowledge state.

**4. Connects to AI** — MCP server with 12 tools. Your AI coding assistant can search your notes, pull context, track decisions, and build on what you already know — instead of starting from scratch every time.

**5. Makes it visible** — Interactive 3D graph where you can explore connections, filter by type/source/time, zoom from universe to individual notes, and export screenshots.

## Quick Start

```bash
# Install
npm install

# Index your Obsidian vault
npx stellavault index /path/to/your/vault

# See your knowledge come alive
npx stellavault graph
```

Short alias: `sv`
```bash
npx sv index /path/to/vault
npx sv graph
npx sv decay    # what's fading?
npx sv brief    # daily knowledge briefing
```

## Give Your AI Agent Memory

```bash
claude mcp add stellavault -- npx stellavault serve
```

Now Claude Code can:
- Search your entire knowledge base semantically
- Pull full documents with context
- Find related notes to what you're working on
- Track and recall your technical decisions
- Tell you what knowledge is decaying
- Give you a morning briefing of your knowledge health

### MCP Tools

| Tool | What it does |
|------|-------------|
| `search` | Hybrid search (BM25 + vector + RRF fusion) |
| `get-document` | Full document with metadata |
| `get-related` | Semantically similar documents |
| `list-topics` | Topic cloud from your vault |
| `get-decay-status` | What's fading, what needs review |
| `get-morning-brief` | Daily knowledge health briefing |
| `log-decision` / `find-decisions` | Technical decision journal |
| `create-snapshot` / `load-snapshot` | Context snapshots |
| `generate-claude-md` | Auto-generate CLAUDE.md from your knowledge |
| `export` | Export as JSON/CSV |

## Intelligence Features

### Memory Decay (FSRS)
Every note has a retrievability score (0-100%). It decays over time based on the FSRS spaced repetition algorithm. Access a note — retrievability resets. Ignore it — it fades. `stellavault decay` shows what needs attention. `stellavault review` runs an interactive review session.

### Knowledge Gaps
Analyzes cluster structure to find disconnected topic areas. Suggests bridge topics and can auto-generate bridge notes to fill the gaps.

### Duplicate Detection
Vector similarity finds notes that say the same thing differently. One-click merge keeps the longer version and appends unique content from the shorter one.

### Health Dashboard
One view for everything: average retrievability, critical notes count, gap severity, duplicate pairs, source/type distribution, monthly growth trends.

## 3D Knowledge Graph

- **Semantic mode** — K-means clustering by meaning, edges by cosine similarity
- **Folder mode** — Cluster by Obsidian folder structure
- **Constellation view** — MST-based star map with 3-level LOD (universe → constellation → note)
- **Timeline slider** — Filter by date range with histogram
- **Type/source filter** — Show only clips, synced notes, bridges, etc.
- **Search with history** — Highlight matching nodes, camera auto-focuses, recent searches saved
- **Decay overlay** — Nodes fade as retrievability drops
- **Motion control** — MediaPipe hand gestures
- **Export** — PNG screenshots, WebM recordings

## CLI Commands

```bash
stellavault index <vault-path>    # Vectorize + chunk + embed your vault
stellavault search <query>        # Terminal search with highlights
stellavault graph                 # Launch 3D graph + API server
stellavault serve                 # MCP server (stdio)
stellavault status                # Index stats
stellavault decay                 # Memory decay report
stellavault brief                 # Daily briefing
stellavault digest                # Weekly activity report
stellavault review                # FSRS-based review session
stellavault gaps                  # Knowledge gap detection
stellavault duplicates            # Duplicate detection
stellavault clip <url>            # Clip web/YouTube to vault
stellavault sync                  # Notion → Obsidian sync
stellavault card                  # SVG profile card
stellavault pack <cmd>            # Knowledge Pack management
```

## Architecture

```
stellavault/
├── packages/
│   ├── core/       Search engine, MCP server, REST API, intelligence layer
│   ├── cli/        15 CLI commands
│   ├── graph/      3D visualization (React Three Fiber)
│   └── sync/       Notion ↔ Obsidian sync
└── scripts/
    └── api-only.mjs   Standalone API server
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 20+ (ESM) |
| Language | TypeScript (strict) |
| Vector Store | SQLite-vec (better-sqlite3) |
| Embedding | all-MiniLM-L6-v2 (384d, local) |
| Search | BM25 + Cosine + RRF Fusion |
| 3D | React Three Fiber + Three.js |
| State | Zustand |
| Memory Model | FSRS (Free Spaced Repetition Scheduler) |
| AI Integration | MCP (Model Context Protocol) |
| Testing | Vitest |

## Configuration

`.stellavault.json` in project root or home directory:

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
