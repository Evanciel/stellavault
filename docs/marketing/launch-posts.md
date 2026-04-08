# Stellavault Launch Posts

## Product Hunt (Title + Tagline + Description)

**Title:** Stellavault — Self-compiling knowledge MCP server

**Tagline:** Drop anything. It compiles itself into knowledge. Claude knows what you know.

**Description:**
Stellavault turns your Obsidian vault into a self-compiling knowledge system.

Drop a PDF, paste a YouTube link, drag a DOCX — it auto-organizes into a Zettelkasten wiki with linked concepts and backlinks. No manual organizing ever.

Then Claude accesses everything through MCP tools. Ask questions, generate drafts, track fading memories — all from your local knowledge base.

**Key features:**
- Ingest anything: PDF, YouTube (with transcript), DOCX, PPTX, XLSX, URLs
- Auto-compile: raw notes → linked wiki in <100ms
- MCP tools for Claude Code integration
- 3D neural knowledge graph in your browser
- TipTap WYSIWYG editor with YouTube embed
- Session hooks + daily log flush (Karpathy's compounding loop)
- Draft generation: blog, report, Instagram, X thread, video script
- Local-first: SQLite-vec, no cloud, 50+ language search

**Pricing:** Free & open source (MIT)

---

## Reddit r/ObsidianMD

**Title:** I built a self-compiling knowledge system for Obsidian — drops any file, auto-organizes into wiki, Claude accesses via MCP tools

**Body:**
Hey everyone,

I've been working on Stellavault — it turns your Obsidian vault into a self-compiling knowledge system inspired by Andrej Karpathy's LLM knowledge base concept.

**The idea:** You drop anything (PDF, YouTube link, DOCX, text) and it automatically:
1. Extracts text (even YouTube transcripts with timestamps)
2. Classifies and stores as a Zettelkasten note
3. Auto-links to related existing notes via [[wikilinks]]
4. Compiles into a structured wiki with concepts + backlinks
5. Makes everything searchable via hybrid AI search (BM25 + vector)

**The killer feature:** MCP tools for Claude Code. One command (`claude mcp add stellavault -- stellavault serve`) and Claude can search, ask, draft, and navigate your entire vault.

**Other cool stuff:**
- 3D neural knowledge graph (Three.js)
- TipTap WYSIWYG editor in the browser
- Draft generator (blog, Instagram, X thread, video script formats)
- Session hooks → daily logs → flush → wiki (Karpathy's compounding loop)
- FSRS memory decay tracking
- 50+ language search (multilingual embeddings)

```bash
npm install -g stellavault
stellavault init
stellavault graph
```

It's MIT licensed, 100% free, local-first (no cloud needed).

GitHub: https://github.com/Evanciel/stellavault
Landing: https://evanciel.github.io/stellavault/

Would love your feedback! Especially from people with large vaults (1000+ notes).

---

## Reddit r/ClaudeAI

**Title:** Made an MCP server with 21 tools that gives Claude full access to your Obsidian knowledge base

**Body:**
Built Stellavault — a self-compiling knowledge MCP server. One command to connect:

```bash
claude mcp add stellavault -- stellavault serve
```

Now Claude can:
- `search` your vault with hybrid AI (BM25 + vector + RRF)
- `ask` questions and get answers with source citations
- `generate-draft` blog posts from your notes (free, no API key needed)
- `detect-gaps` in your knowledge
- `get-decay-status` to see what you're forgetting (FSRS)
- `link-code` to connect code files to knowledge notes
- ... 21 tools total

The compounding loop: every session summary auto-saves to your vault → flush compiles into wiki → Claude reads the wiki next time → gets smarter about your project.

Free, MIT, local-first. `npm install -g stellavault`

---

## X/Twitter Thread

**1/** I built a self-compiling knowledge system.

Drop a PDF, paste a YouTube link, type a thought → it auto-organizes into a Zettelkasten wiki.

Claude accesses everything via MCP tools.

Here's how it works: 🧵

**2/** The pipeline (inspired by @kaborpa):

Capture → Organize → Distill → Express

Every input goes through the same flow. You never manually organize. Auto-wikilinks, auto-tags, auto-compile.

**3/** Ingest anything:
- PDF (unpdf)
- YouTube (transcript + timestamps via yt-dlp)
- DOCX/PPTX/XLSX
- URLs
- Drag & drop in browser

One command: `stellavault ingest <anything>`

**4/** Claude integration (MCP tools):

`claude mcp add stellavault -- stellavault serve`

Now Claude can search, ask, draft, detect gaps, track memories — from YOUR vault.

The generate-draft tool is free (no API key). Claude writes blog posts from your notes.

**5/** The compounding loop:

Session → session-save → daily-log → flush → wiki → MCP → Claude → better answers → repeat

Every conversation makes your knowledge base smarter.

**6/** 3D neural knowledge graph in your browser.

Right-click to add/connect/delete nodes.
TipTap WYSIWYG editor with YouTube embed.
Dark/light mode. Mobile PWA.

**7/** Draft anything:
- Blog post
- Report
- Instagram carousel
- X thread
- Video script
- Custom blueprint

All from your accumulated knowledge.

**8/** Free. MIT. Local-first.
No cloud, no API key for core features.
50+ language search.
127 tests passing.

```
npm install -g stellavault
```

GitHub: github.com/Evanciel/stellavault

---

## Discord (Obsidian / Claude / PKM communities)

**Short version:**
Built Stellavault — self-compiling Obsidian knowledge system with MCP tools for Claude. Drop PDFs, YouTube, docs → auto-wiki. Claude accesses everything. Free, MIT. `npm install -g stellavault` | https://github.com/Evanciel/stellavault
