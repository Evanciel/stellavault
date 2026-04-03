# Stellavault

> **Notes die in folders. Stellavault keeps your knowledge alive.**

Your Obsidian vault is more than files. It's a living network — connections emerge, memories fade, gaps appear. Stellavault turns it into a knowledge system that **discovers hidden connections**, **detects fading memories**, **finds blind spots**, and **gives AI agents direct access to everything you know**.

## 30-Second Setup

```bash
# Install globally
npm install -g stellavault

# Interactive setup wizard
stellavault init

# Or manually: index your vault + launch 3D graph
stellavault index /path/to/obsidian/vault
stellavault graph
```

That's it. Open `http://localhost:5173` to see your knowledge come alive in 3D.

## Give Your AI Agent Memory

```bash
claude mcp add stellavault -- stellavault serve
```

Now Claude Code can search your notes, track your decisions, tell you what's fading, and give you a daily knowledge briefing — using 17+ MCP tools.

## What It Does

**Understands** — Vectorizes every note locally (no API keys needed). Hybrid search combines BM25 + cosine similarity + RRF fusion.

**Remembers** — FSRS spaced repetition tracks what you're forgetting. `stellavault decay` shows what's fading. `stellavault review` runs a review session.

**Discovers** — Gap detector finds missing connections. Duplicate finder catches redundancy. Contradiction detector spots conflicting statements. Learning path tells you what to study next.

**Visualizes** — Interactive 3D neural graph with constellation view, timeline slider, type filters, health dashboard, and keyboard navigation.

**Connects** — Federation protocol links your vault to other Stellavault nodes via P2P. Search across the network without sharing your raw text. Multiverse UI shows your universe alongside connected peers.

## Key Features

| Category | Features |
|----------|----------|
| **Search** | Hybrid BM25+Vector+RRF, semantic search, search history |
| **Intelligence** | FSRS decay, gap detection, duplicates, contradictions, predictive gaps, learning paths |
| **Visualization** | 3D graph, constellation view, timeline, type filter, health dashboard, embed widget |
| **AI Integration** | 17+ MCP tools, custom MCP tool builder (YAML), agentic graph construction |
| **Federation** | P2P search, multiverse UI, reputation system, trust scoring, differential privacy |
| **Security** | E2E cloud sync (AES-256-GCM), team auth (RBAC), sharing controls, SSRF/XSS protection |
| **Platform** | Web dashboard, PWA, voice capture (Whisper), Notion sync, multi-vault, i18n (en/ko/ja/zh) |
| **Extensibility** | Plugin SDK, webhook system, Knowledge Pack marketplace |

## CLI (28+ commands)

```bash
# Core
stellavault init                  # Interactive setup wizard
stellavault index <vault-path>    # Vectorize your vault
stellavault search <query>        # Semantic search
stellavault graph                 # Launch 3D graph
stellavault serve                 # MCP server for AI agents
stellavault status                # Index stats

# Intelligence
stellavault decay                 # What's fading?
stellavault learn                 # AI learning path
stellavault brief                 # Daily knowledge briefing
stellavault digest                # Weekly report
stellavault review                # FSRS review session
stellavault gaps                  # Knowledge gap detection
stellavault duplicates            # Duplicate detection
stellavault contradictions        # Contradiction detection

# Federation
stellavault federate join         # Join P2P network
stellavault federate status       # Node identity

# Multi-Vault
stellavault vault add <id> <path> # Register a vault
stellavault vault search-all <q>  # Search across all vaults

# Cloud
stellavault cloud sync            # E2E encrypted backup
stellavault cloud restore         # Restore from cloud

# More
stellavault clip <url>            # Web/YouTube clipper
stellavault sync                  # Notion → Obsidian
stellavault capture <audio>       # Voice → knowledge (Whisper)
stellavault card                  # SVG profile card
stellavault pack <cmd>            # Knowledge Pack management
```

Use short alias `sv` for all commands: `sv graph`, `sv decay`, `sv learn`

## MCP Tools (17+)

| Tool | What it does |
|------|-------------|
| `search` | Hybrid search (BM25 + vector + RRF) |
| `get-document` | Full document with metadata |
| `get-related` | Semantically similar documents |
| `list-topics` | Topic cloud |
| `get-decay-status` | Memory decay report |
| `get-morning-brief` | Daily knowledge briefing |
| `get-learning-path` | AI learning recommendations |
| `federated-search` | Search across P2P network |
| `create-knowledge-node` | AI creates notes during conversation |
| `create-knowledge-link` | AI creates links between notes |
| `log-decision` / `find-decisions` | Technical decision journal |
| `create-snapshot` / `load-snapshot` | Context snapshots |
| `generate-claude-md` | Auto-generate CLAUDE.md |
| `export` | JSON/CSV export |

## Federation — P2P Knowledge Network

Each Stellavault is a node. Connect to discover knowledge across the network — without sharing your raw text.

```bash
stellavault federate join --name "my-node"
# Interactive mode:
federation> search kubernetes deployment
#  87% "K8s Rolling Update Guide" [peer-alice]
#     Kubernetes에서 무중단 배포를 위해...
federation> peers
#  alice (1,209 docs) [trust: 88]
#  bob (47 docs) [trust: 72]
```

**Privacy**: Only titles + similarity scores + 50-char masked snippets cross the network. Never raw text. Differential privacy noise on embeddings. Sharing controls per tag/folder.

**Trust**: Web of Trust + automatic reputation scoring (consistency, consensus, helpfulness).

## Architecture

```
stellavault/
├── packages/
│   ├── core/       Search, MCP, API, Intelligence, Federation, Cloud, Team, i18n
│   ├── cli/        28+ commands
│   ├── graph/      3D visualization + Multiverse UI (React Three Fiber)
│   └── sync/       Notion ↔ Obsidian sync
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 20+ (ESM, TypeScript) |
| Vector Store | SQLite-vec (local, no server) |
| Embedding | all-MiniLM-L6-v2 (local, no API key) |
| Search | BM25 + Cosine + RRF Fusion |
| 3D | React Three Fiber + Three.js + Zustand |
| Memory | FSRS (Free Spaced Repetition Scheduler) |
| P2P | Hyperswarm (NAT traversal + DHT) |
| AI | MCP (Model Context Protocol) |
| Security | AES-256-GCM, HMAC-SHA256, Differential Privacy |

## Configuration

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

## Links

- [Wiki: Vault Structure Guide](docs/wiki/vault-structure.md)
- [Wiki: Notion Setup](docs/wiki/notion-setup.md)
- [Wiki: Federation Guide](docs/wiki/federation-guide.md)
