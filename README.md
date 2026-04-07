# Stellavault

> **Self-compiling knowledge MCP server** — ingest anything, auto-organize into Zettelkasten wiki, and let Claude access your entire knowledge base.

Drop a PDF, paste a YouTube link, type a thought — Stellavault compiles it into structured knowledge, connects the dots, and gives your AI agent full access through 20 MCP tools.

<p align="center">
  <img src="images/screenshots/graph-dark-full.png" alt="3D Knowledge Graph" width="800" />
  <br><em>Your vault as a neural network. Clusters form constellations.</em>
</p>

## Two Core Ideas

**1. "Drop it and forget it"** (Karpathy's Self-Compiling Knowledge)
```
Any input → auto-classify → raw/ → compile → wiki → connected knowledge
```
PDF, DOCX, YouTube, URL, text — everything goes through the same pipeline. You never manually organize.

**2. "Claude knows what you know"** (MCP Integration)
```bash
claude mcp add stellavault -- stellavault serve
```
20 MCP tools give Claude direct access to search, ask, draft, and navigate your entire knowledge base.

## 5-Minute Setup

```bash
npm install -g stellavault
stellavault init          # Interactive setup + vault indexing
stellavault graph         # Launch 3D graph + API server
```

> **Prerequisites**: Node.js 20+

## The Pipeline

```
Capture ──→ Organize ──→ Distill ──→ Express

stellavault ingest <anything>     # PDF, DOCX, URL, YouTube, text
  → auto-extract text             # unpdf, mammoth, yt-dlp
  → raw/ (fleeting)               # Zettelkasten inbox
  → compile → _wiki/              # Auto: concepts + backlinks
  → stellavault draft "topic"     # Blog, report, or outline
```

### Ingest Anything

| Input | How |
|-------|-----|
| PDF, DOCX, PPTX, XLSX | `stellavault ingest report.pdf` — auto text extraction |
| YouTube | `stellavault ingest https://youtu.be/...` — transcript + timestamps |
| URL | `stellavault ingest https://...` — HTML → clean text |
| Text | `stellavault ingest "quick thought"` |
| Web UI | Drag & drop files in browser (mobile too) |

### Express: Get Knowledge Out

```bash
stellavault draft "AI"                    # Rule-based scaffold (free)
stellavault draft "AI" --ai               # Claude API writes full draft ($0.03)
stellavault draft "AI" --format report    # Formal report format
stellavault draft --format outline        # All-knowledge outline
```

Or in Claude Code: *"Write a blog post about machine learning from my notes"* — Claude uses MCP `generate-draft` tool (free, no API key).

## Daily Commands

```bash
stellavault ask "What did I learn about X?"   # Q&A from vault
stellavault brief                              # Morning knowledge briefing
stellavault decay                              # What's fading from memory?
stellavault lint                               # Health score (0-100)
stellavault learn                              # AI learning path
stellavault digest --visual                    # Weekly Mermaid chart report
```

## MCP Tools (20)

| Tool | What it does |
|------|-------------|
| `search` | Hybrid search (BM25 + vector + RRF) |
| `ask` | Q&A with optional vault filing |
| `generate-draft` | Gather vault context for AI draft writing |
| `get-document` | Full document with metadata |
| `get-related` | Semantically similar documents |
| `list-topics` | Topic cloud |
| `get-decay-status` | Memory decay report |
| `get-morning-brief` | Daily knowledge briefing |
| `get-learning-path` | AI learning recommendations |
| `detect-gaps` | Knowledge gap analysis |
| `get-evolution` | Semantic drift tracking |
| `link-code` | Code-knowledge connections |
| `create-knowledge-node` | AI creates wiki-quality notes |
| `create-knowledge-link` | AI connects existing notes |
| `log-decision` / `find-decisions` | Decision journal |
| `create-snapshot` / `load-snapshot` | Context snapshots |
| `generate-claude-md` | Auto-generate CLAUDE.md |
| `export` | JSON/CSV export |

## Zettelkasten (Luhmann + Karpathy)

```bash
stellavault fleeting "raw idea"                # → raw/
stellavault ingest report.pdf                  # → auto text extract → raw/
stellavault compile                            # → raw/ → _wiki/ (concepts + backlinks)
stellavault promote note.md --to permanent     # Upgrade stage
stellavault autopilot                          # Full cycle: inbox → compile → lint → archive
```

- **3-stage flow**: fleeting → literature → permanent
- **Luhmann index codes**: auto-assigned (1A → 1A1)
- **Frontmatter-first scanning**: 10x token reduction
- **Configurable folders**: override raw/_wiki/_literature/ in `.stellavault.json`

```json
{
  "vaultPath": "/path/to/vault",
  "folders": {
    "fleeting": "01-Inbox",
    "literature": "02-Reading",
    "permanent": "03-Notes",
    "wiki": "04-Wiki"
  }
}
```

## Intelligence

| Feature | Command |
|---------|---------|
| FSRS Decay | `sv decay` — spaced repetition memory tracking |
| Gap Detection | `sv gaps` — missing connections between topics |
| Contradictions | `sv contradictions` — conflicting statements |
| Duplicates | `sv duplicates` — redundant notes |
| Learning Path | `sv learn` — AI review recommendations |
| Code Linker | MCP `link-code` — connect code to knowledge |

## 3D Visualization

- Neural graph with cluster coloring
- Constellation view (MST star patterns)
- Heatmap overlay (activity score)
- Timeline slider (creation/modification filter)
- Decay overlay (fading knowledge)
- Dark/Light theme
- Mobile responsive + PWA installable

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 20+ (ESM, TypeScript) |
| Vector Store | SQLite-vec (local, no server) |
| Embedding | paraphrase-multilingual-MiniLM-L12-v2 (local, 50+ languages) |
| Search | BM25 + Cosine + RRF Fusion |
| File Parsing | unpdf, mammoth, officeparser, SheetJS |
| Memory | FSRS (Free Spaced Repetition Scheduler) |
| 3D | React Three Fiber + Three.js |
| AI | MCP (Model Context Protocol) + Anthropic SDK |

## License

MIT

## Links

- [Obsidian Plugin](https://github.com/Evanciel/stellavault-obsidian)
- [npm](https://www.npmjs.com/package/stellavault)
- [GitHub Releases](https://github.com/Evanciel/stellavault/releases)
