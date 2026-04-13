# Stellavault

> **Drop anything. It compiles itself into knowledge.** Claude remembers everything you know.

Self-compiling knowledge base with 3D neural graph, AI-powered search, and spaced repetition — available as a **desktop app**, **CLI**, **Obsidian plugin**, and **MCP server**. Your vault files are never modified.

<p align="center">
  <img src="images/screenshots/graph-main-2.png" alt="3D Knowledge Graph" width="800" />
  <br><em>Your vault as a neural network. Local-first, no cloud required.</em>
</p>

## Three Ways to Use Stellavault

### 1. Desktop App (Recommended)

Download and run — no terminal needed.

| Platform | Download | Size |
|----------|----------|------|
| **Windows x64** | [Stellavault-win32-x64-0.1.0.zip](https://github.com/Evanciel/stellavault/releases/download/desktop-v0.1.0/Stellavault-win32-x64-0.1.0.zip) | 116 MB |
| **Linux x64** | [Stellavault-linux-x64-0.1.0.zip](https://github.com/Evanciel/stellavault/releases/download/desktop-v0.1.0/Stellavault-linux-x64-0.1.0.zip) | 107 MB |
| macOS | Coming soon (requires Apple code signing) | — |

**What you get:**
- Full markdown editor with WYSIWYG toolbar
- File tree sidebar with search filter
- `[[wikilink]]` autocomplete as you type
- Multi-tab editing with Ctrl+S save
- 3D knowledge graph panel
- AI panel — semantic search, vault stats, re-index
- Backlinks panel — see who links to your note
- Quick Switcher (Ctrl+P) and Command Palette (Ctrl+Shift+P)
- Dark/light theme

### 2. CLI + Web Graph

For developers and power users.

```bash
npm install -g stellavault    # or: npx stellavault
stellavault init              # Interactive setup wizard
stellavault graph             # Launch 3D graph in browser
```

> **Prerequisites**: Node.js 20+. Run `stellavault doctor` to diagnose setup issues.

### 3. Obsidian Plugin

Use Stellavault intelligence inside Obsidian.

1. Download from [stellavault-obsidian releases](https://github.com/Evanciel/stellavault-obsidian/releases/latest)
2. Place `main.js`, `manifest.json`, `styles.css` in `.obsidian/plugins/stellavault/`
3. Enable in Settings → Community plugins
4. Start the API server: `npx stellavault graph` in your vault folder

**Features:** Semantic search modal, memory decay sidebar, learning path suggestions, auto-indexing on file changes.

---

## The Pipeline

```
Capture ──→ Organize ──→ Distill ──→ Express

Drop anything → auto-extract → raw/ → compile → _wiki/ → draft
```

Inspired by [Karpathy's self-compiling knowledge](https://karpathy.ai/) architecture. Every input flows through the same four-stage pipeline.

### Ingest Anything (14 formats)

| Input | How |
|-------|-----|
| PDF, DOCX, PPTX, XLSX | `stellavault ingest report.pdf` |
| JSON, CSV, XML, YAML, HTML, RTF | `stellavault ingest data.json` |
| YouTube | `stellavault ingest https://youtu.be/...` — transcript + timestamps |
| URL | `stellavault ingest https://...` — HTML → markdown |
| Text | `stellavault ingest "quick thought"` |
| Folder | `stellavault ingest ./papers/` — batch all files |
| Desktop / Web UI | Drag & drop files directly |

### Express: Get Knowledge Out

```bash
stellavault draft "AI"                    # Rule-based scaffold (free)
stellavault draft "AI" --ai               # Claude API writes full draft
stellavault draft "AI" --format report    # Formal report
stellavault draft --format instagram      # Social media format
```

## MCP Integration (21 Tools)

Connect Stellavault to Claude Code or Claude Desktop:

```bash
claude mcp add stellavault -- stellavault serve
```

Claude can now search, ask, draft, lint, and analyze your vault directly.

| Tool | What it does |
|------|-------------|
| `search` | Hybrid BM25 + vector + RRF search |
| `ask` | Q&A with vault-grounded answers |
| `generate-draft` | AI drafts from your knowledge |
| `get-decay-status` | Memory decay report (FSRS) |
| `detect-gaps` | Knowledge gap analysis |
| `get-learning-path` | Personalized review recommendations |
| `create-knowledge-node` | AI creates wiki-quality notes |
| `federated-search` | P2P search across connected vaults |
| + 13 more | Documents, topics, decisions, snapshots, export |

## Intelligence

| Feature | Command |
|---------|---------|
| Memory Decay | `stellavault decay` — what you're forgetting (FSRS) |
| Gap Detection | `stellavault gaps` — weak connections between topics |
| Contradictions | `stellavault contradictions` — conflicting statements |
| Duplicates | `stellavault duplicates` — redundant notes |
| Learning Path | `stellavault learn` — AI review recommendations |
| Health Check | `stellavault lint` — overall knowledge score |
| Daily Brief | `stellavault brief` — morning knowledge briefing |
| Weekly Digest | `stellavault digest --visual` — Mermaid chart report |

## Self-Evolving Memory

```
Session → session-save → daily-log → flush → wiki
  ↑                                            ↓
  └──── Claude reads wiki via MCP (21 tools) ←─┘
```

Every conversation makes your knowledge base smarter. Set up [Claude Code hooks](docs/hooks-setup.md) for full automation.

## Zettelkasten Workflow

Three-stage flow: **fleeting → literature → permanent** (Luhmann + Karpathy).

```bash
stellavault fleeting "raw idea"               # → raw/
stellavault ingest report.pdf                 # → auto-extract → raw/
stellavault compile                           # → raw/ → _wiki/ (concepts + backlinks)
stellavault promote note.md --to permanent    # Upgrade stage
stellavault autopilot                         # Full cycle: inbox → compile → lint
```

Auto-assigned Luhmann index codes, frontmatter-first scanning, configurable folders.

## P2P Federation (Multiverse)

Your vault is a universe. Connect with others through P2P federation.

- **Hyperswarm P2P** — NAT-traversal, no central server
- **Embeddings only** — original text never leaves your machine
- **Differential privacy** — mathematical privacy guarantees

In the desktop app or web UI, click the **Federation badge** in the header to join/leave the Stella Network.

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop | Electron + React + TipTap + Zustand |
| Runtime | Node.js 20+ (ESM, TypeScript) |
| Vector Store | SQLite-vec (local, zero config) |
| Embedding | MiniLM-L12-v2 (local, 50+ languages) |
| Search | BM25 + Cosine + RRF Fusion |
| File Parsing | unpdf, mammoth, officeparser, SheetJS |
| Memory | FSRS (Free Spaced Repetition Scheduler) |
| 3D | React Three Fiber + Three.js |
| AI | MCP (Model Context Protocol) + Anthropic SDK |
| P2P | Hyperswarm (optional) |

## Full Feature List

| Category | Features |
|----------|----------|
| **Desktop** | File tree sidebar, multi-tab editor, [[wikilink]] autocomplete, Quick Switcher, Command Palette, 3D graph panel, AI panel, backlinks, dark/light theme |
| **Capture** | 14 formats (PDF/DOCX/PPTX/XLSX/JSON/CSV/XML/HTML/YAML/RTF/YouTube/URL/text), batch folders, drag & drop, voice capture, Quick Capture |
| **Organize** | Zettelkasten 3-stage, auto index codes, wikilink auto-connect, configurable folders |
| **Distill** | compile (raw→wiki), lint (health score), gaps, contradictions, duplicates |
| **Express** | draft (blog/report/outline/instagram/thread/script), blueprint, --ai mode |
| **Memory** | FSRS decay, session-save, flush, compounding loop, ADR templates |
| **Search** | hybrid (BM25+vector+RRF), multilingual 50+, ask Q&A, quotes mode |
| **Visualize** | 3D graph, heatmap, timeline, constellation view, decay overlay, multiverse |
| **AI** | 21 MCP tools, Claude Code hooks, Anthropic SDK |
| **Federation** | Hyperswarm P2P, embedding-only sharing, differential privacy |
| **CLI** | 40+ commands, `sv` alias, `stellavault doctor` diagnostics |

## Getting Started Guide

### Desktop App (easiest)

1. **Download** from [Releases](https://github.com/Evanciel/stellavault/releases/latest)
2. **Unzip** to any folder
3. **Run** `stellavault.exe` (Windows) — first launch asks you to pick your notes folder
4. **Explore** — your notes appear in the sidebar, click to open in the editor
5. **Search** — press `Ctrl+P` to quick-switch between notes, or open the AI panel (✦ button) for semantic search

### CLI (for developers)

```bash
# Step 1: Install
npm install -g stellavault

# Step 2: Setup (interactive wizard)
stellavault init
# → Asks for vault path → indexes all .md files → tests search

# Step 3: Daily use
stellavault search "machine learning"     # Find notes
stellavault ingest paper.pdf              # Add new knowledge
stellavault graph                         # Open 3D graph in browser
stellavault brief                         # Morning briefing
stellavault decay                         # What are you forgetting?

# Step 4: Connect to Claude
claude mcp add stellavault -- stellavault serve
# → Claude can now read your vault via MCP
```

### Obsidian Plugin

```bash
# Step 1: Start the API server (keep running)
npx stellavault graph

# Step 2: Install plugin
#   Download main.js + manifest.json + styles.css from:
#   https://github.com/Evanciel/stellavault-obsidian/releases/latest
#   Place in: <vault>/.obsidian/plugins/stellavault/

# Step 3: Enable in Settings → Community Plugins → Stellavault

# Step 4: Use
#   - Click brain icon (🧠) for semantic search
#   - Cmd+Shift+D for memory decay panel
#   - Cmd+Shift+L for learning path suggestions
```

### Quick Reference

| Action | Desktop | CLI | Obsidian |
|--------|---------|-----|----------|
| Search notes | Ctrl+P or AI panel | `stellavault search "query"` | 🧠 icon |
| Add a note | + Note button | `stellavault ingest "text"` | Normal editing |
| See 3D graph | ◉ button | `stellavault graph` | N/A |
| Check memory decay | AI panel → Memory | `stellavault decay` | Decay sidebar |
| Find duplicates | AI panel → Stats | `stellavault duplicates` | N/A |
| Generate draft | N/A (v0.2) | `stellavault draft "topic"` | N/A |
| Connect to Claude | N/A (v0.2) | `claude mcp add stellavault` | N/A |

### Configuration

All settings live in `~/.stellavault.json`:

```json
{
  "vaultPath": "/path/to/your/notes",
  "dbPath": "~/.stellavault/index.db",
  "embedding": { "model": "local", "localModel": "all-MiniLM-L6-v2" },
  "mcp": { "mode": "stdio", "port": 3333 }
}
```

Run `stellavault doctor` anytime to check your setup.

### Keyboard Shortcuts (Desktop)

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Quick Switcher (fuzzy file search) |
| `Ctrl+Shift+P` | Command Palette (all actions) |
| `Ctrl+S` | Save current note |
| `Ctrl+B` | Toggle bold |
| `Ctrl+I` | Toggle italic |
| `Ctrl+E` | Toggle inline code |
| `[[` | Wikilink autocomplete |

## Troubleshooting

```bash
stellavault doctor    # Check config, vault, DB, model, Node version
```

Common issues:
- **"Command not found"** → Reinstall: `npm i -g stellavault@latest`
- **"API server not found"** → Start the server: `npx stellavault graph`
- **Empty graph** → Run `stellavault index` to re-index your vault
- **Slow first run** → The AI model downloads ~30MB on first use (one time only)

## Security

Local-first — no data leaves your machine unless you explicitly use `--ai` (Anthropic API). Vault files are never modified. See [SECURITY.md](SECURITY.md).

## License

MIT — full source code available for audit.

## Links

- **[Download Desktop App](https://github.com/Evanciel/stellavault/releases/latest)**
- [Landing Page](https://evanciel.github.io/stellavault/)
- [Obsidian Plugin](https://github.com/Evanciel/stellavault-obsidian)
- [npm](https://www.npmjs.com/package/stellavault)
- [GitHub Releases](https://github.com/Evanciel/stellavault/releases)
- [Security Policy](SECURITY.md)
