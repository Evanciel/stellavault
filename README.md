# Stellavault

[![CI](https://github.com/Evanciel/stellavault/actions/workflows/ci.yml/badge.svg)](https://github.com/Evanciel/stellavault/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/stellavault)](https://www.npmjs.com/package/stellavault) [![tests](https://img.shields.io/badge/tests-177%20passing-brightgreen)]()

> **Drop anything. It compiles itself into knowledge.** Claude remembers everything you know.

Self-compiling knowledge base with a full-featured editor, 3D neural graph, AI-powered search, and spaced repetition — available as a **desktop app**, **CLI**, **Obsidian plugin**, and **MCP server**. Your vault files are never modified.

<p align="center">
  <img src="images/screenshots/graph-main-2.png" alt="3D Knowledge Graph" width="800" />
  <br><em>Your vault as a neural network. Local-first, no cloud required.</em>
</p>

## Install

### Desktop App (Recommended — one click)

<table>
  <tr>
    <td align="center"><a href="https://github.com/Evanciel/stellavault/releases/download/desktop-v0.1.0/Stellavault-win32-x64-0.1.0.zip"><br/><b>⬇ Download for Windows</b><br/><sub>x64 · 116 MB · ZIP</sub></a></td>
    <td align="center"><a href="https://github.com/Evanciel/stellavault/releases/download/desktop-v0.1.0/Stellavault-linux-x64-0.1.0.zip"><br/><b>⬇ Download for Linux</b><br/><sub>x64 · 107 MB · ZIP</sub></a></td>
    <td align="center"><br/><b>macOS</b><br/><sub>Coming soon</sub></td>
  </tr>
</table>

> Download → Unzip → Run `stellavault.exe` (Windows) or `stellavault` (Linux) → Pick your notes folder → Done.

### CLI (for developers)

```bash
npm install -g stellavault    # or: npx stellavault
stellavault init              # Interactive setup wizard (3 min)
stellavault graph             # Launch 3D graph in browser
```

> Requires Node.js 20+. Run `stellavault doctor` to diagnose issues.

### Obsidian Plugin

1. Download `main.js` + `manifest.json` + `styles.css` from [stellavault-obsidian releases](https://github.com/Evanciel/stellavault-obsidian/releases/latest)
2. Place in `.obsidian/plugins/stellavault/`
3. Enable in Settings → Community plugins
4. Start API: `npx stellavault graph` in your vault folder

---

## Editor

Full-featured markdown editor — on par with Obsidian.

| Feature | Status |
|---------|--------|
| Bold, Italic, Underline, Strikethrough | ✅ |
| Headings 1–6 | ✅ |
| Bullet, Numbered, Task lists (nested checkboxes) | ✅ |
| Tables (create, resize columns, add/remove rows & cols) | ✅ |
| Code blocks with syntax highlighting (40+ languages) | ✅ |
| Images (URL, clipboard paste, drag & drop) | ✅ |
| KaTeX math rendering (`$E=mc^2$` inline, `$$...$$` display) | ✅ |
| `/Slash commands` (12 block types, fuzzy search) | ✅ |
| `[[Wikilink]]` autocomplete | ✅ |
| Split view (vertical + horizontal, Ctrl+\\) | ✅ |
| Text alignment (left / center / right) | ✅ |
| Highlight, Superscript, Subscript | ✅ |
| Smart typography (curly quotes, em/en dashes) | ✅ |
| Horizontal rules | ✅ |

---

## The Pipeline

```
Capture ──→ Organize ──→ Distill ──→ Express

Drop anything → auto-extract → raw/ → compile → _wiki/ → draft
```

Inspired by Karpathy's self-compiling knowledge architecture.

### Ingest 14 Formats

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
stellavault draft "AI" --format blog      # Blog post from your vault
stellavault draft "AI" --format outline   # Structured outline
stellavault draft "AI" --ai              # Claude API enhanced ($0.03)
```

Or use the **Express tab** in the desktop app — enter a topic, pick a format, and generate a draft grounded in your vault. Save to `_drafts/` and edit inline.

---

## Intelligence (What Makes Stellavault Unique)

These features do **not exist** in Obsidian — even with plugins.

| Feature | Command / Desktop | Description |
|---------|-------------------|-------------|
| **Memory Decay** | `stellavault decay` / Memory tab | FSRS-based — shows which real notes you are forgetting |
| **Knowledge Gaps** | `stellavault gaps` | Detects weak connections between topic clusters |
| **Contradictions** | `stellavault contradictions` | Finds conflicting statements across your vault |
| **Duplicates** | `stellavault duplicates` | Near-identical notes with similarity score |
| **Health Check** | `stellavault lint` | Aggregated vault health score (0–100) |
| **Learning Path** | `stellavault learn` | AI-personalized review recommendations |
| **Daily Brief** | Desktop app home screen | Push-type: top decaying notes + stats on app open |
| **Auto-Tagging** | Automatic on ingest | Content-based keyword extraction + category rules |
| **Self-Compiling** | `stellavault compile` | raw/ → _wiki/ with extracted concepts + backlinks |

---

## MCP Integration (21 Tools)

```bash
claude mcp add stellavault -- stellavault serve
```

Claude can search, ask, draft, lint, and analyze your vault directly.

| Tool | What it does |
|------|-------------|
| `search` | Hybrid BM25 + vector + RRF |
| `ask` | Vault-grounded Q&A |
| `generate-draft` | AI drafts from your knowledge |
| `get-decay-status` | Memory decay report (FSRS) |
| `detect-gaps` | Knowledge gap analysis |
| `create-knowledge-node` | AI creates wiki-quality notes |
| `federated-search` | P2P search across vaults |
| + 14 more | Documents, topics, decisions, snapshots, export |

---

## 3D Visualization

- Neural graph with cluster coloring (React Three Fiber)
- Constellation view (MST star patterns)
- Heatmap overlay + Timeline slider + Decay overlay
- Multiverse view — your vault as a universe in a P2P network
- Dark/Light theme

---

## Try It Now (Demo Vault)

```bash
npx stellavault index --vault ./examples/demo-vault   # Index 10 sample notes
npx stellavault search "vector database"               # Semantic search
npx stellavault graph                                  # 3D graph visualization
```

The demo vault includes interconnected notes about Vector Databases, Knowledge Graphs, Spaced Repetition, RAG, MCP, and more — perfect for exploring all features instantly.

---

## Getting Started Guide

### Desktop App

1. **Download** → Unzip → Run
2. First launch asks you to pick your notes folder
3. Your notes appear in the sidebar — click to open
4. Press `Ctrl+P` for quick file switching
5. Click ✦ in the title bar for AI panel (semantic search, stats, draft)
6. Click ◉ for 3D graph

### CLI

```bash
npm install -g stellavault
stellavault init                          # Setup wizard
stellavault search "machine learning"     # Semantic search
stellavault ingest paper.pdf              # Add knowledge
stellavault graph                         # 3D graph in browser
stellavault brief                         # Morning briefing
stellavault decay                         # What are you forgetting?
```

### Keyboard Shortcuts (Desktop)

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Quick Switcher (fuzzy file search) |
| `Ctrl+Shift+P` | Command Palette (all actions) |
| `Ctrl+S` | Save current note |
| `Ctrl+\` | Toggle split view |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+U` | Underline |
| `Ctrl+E` | Inline code |
| `/` | Slash commands (at start of line) |
| `[[` | Wikilink autocomplete |

### Quick Reference

| Action | Desktop | CLI |
|--------|---------|-----|
| Search notes | Ctrl+P or AI panel | `stellavault search "query"` |
| Add a note | + Note button or drag & drop | `stellavault ingest "text"` |
| See 3D graph | ◉ button | `stellavault graph` |
| Memory decay | AI panel → Memory | `stellavault decay` |
| Generate draft | AI panel → Draft | `stellavault draft "topic"` |
| Health check | AI panel → Stats | `stellavault lint` |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop | Electron + React + TipTap (15 extensions) + Zustand |
| Runtime | Node.js 20+ (ESM, TypeScript) |
| Vector Store | SQLite-vec (local, zero config) |
| Embedding | MiniLM-L12-v2 (local, 50+ languages, batch processing) |
| Search | BM25 + Cosine + RRF Fusion |
| Math | KaTeX (inline + display) |
| Code | lowlight / highlight.js (40+ languages) |
| 3D | React Three Fiber + Three.js |
| AI | MCP (21 tools) + Anthropic SDK |
| P2P | Hyperswarm (optional, differential privacy) |
| CI | GitHub Actions (Node 20 + 22) |

---

## Security

- **Local-first** — no data leaves your machine unless you use `--ai`
- **Vault files never modified** — indexes into SQLite, originals untouched
- **Electron sandbox enabled** — renderer runs with reduced OS privileges
- **IPC path validation** — all file operations stay inside vault root
- **API auth token** — per-session random token for mutating endpoints
- **SSRF protection** — private IPs blocked on URL ingest
- **E2E encryption** — AES-256-GCM for cloud sync

See [SECURITY.md](SECURITY.md) for full details.

## Troubleshooting

```bash
stellavault doctor    # Check config, vault, DB, model, Node version
```

Common issues:
- **"Command not found"** → `npm i -g stellavault@latest`
- **"API server not found"** → `npx stellavault graph`
- **Empty graph** → `stellavault index`
- **Slow first run** → AI model downloads ~30MB once

## License

MIT — full source code available for audit.

## Links

- **[⬇ Download Desktop App](https://github.com/Evanciel/stellavault/releases/tag/desktop-v0.1.0)**
- [Landing Page](https://evanciel.github.io/stellavault/)
- [Obsidian Plugin](https://github.com/Evanciel/stellavault-obsidian)
- [npm](https://www.npmjs.com/package/stellavault)
- [GitHub Releases](https://github.com/Evanciel/stellavault/releases)
- [Security Policy](SECURITY.md)
