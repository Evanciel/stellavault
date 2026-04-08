# Stellavault Launch Posts

## Product Hunt (Title + Tagline + Description)

**Title:** Stellavault — Self-compiling knowledge MCP server

**Tagline:** Drop anything. It compiles itself into knowledge. Claude remembers what you know.

**Description:**
Drop PDFs, YouTube links, documents — Stellavault auto-organizes into a linked wiki. Claude accesses everything via MCP.

1. Ingest anything (PDF, YouTube transcript, DOCX, XLSX, URL)
2. Auto-compile into wiki with concepts + backlinks
3. Claude searches, asks, and drafts from your vault

Vault files never modified. 100% local-first.

Next: P2P Knowledge Federation — connect vaults across users. Only embeddings shared, never original text.

Free, MIT, open source.

**Pricing:** Free & open source (MIT)

---

## Reddit r/ObsidianMD

**Title:** I built a self-compiling knowledge system for Obsidian — drops any file, auto-wiki, Claude MCP, and a Multiverse view for P2P knowledge sharing

**Body:**
Hey everyone,

I've been working on Stellavault — it turns your Obsidian vault into a self-compiling knowledge system inspired by Andrej Karpathy's LLM knowledge base concept.

**The idea:** You drop anything (PDF, YouTube link, DOCX, text) and it automatically:
1. Extracts text (even YouTube transcripts with timestamps)
2. Classifies and stores as a Zettelkasten note
3. Auto-links to related existing notes via [[wikilinks]]
4. Compiles into a structured wiki with concepts + backlinks
5. Makes everything searchable via hybrid AI search (BM25 + vector)

**Claude integration:** One command (`claude mcp add stellavault -- stellavault serve`) and Claude can search, ask, draft, and navigate your entire vault. Your vault files are never modified.

**The vision — Multiverse:**
Stellavault already has a P2P federation layer built in (Hyperswarm). The "Multiverse view" shows your vault as a universe — and connected peers as neighboring constellations. Only embeddings are shared, never your original text (differential privacy). Trust builds through a reputation system.

Right now your universe floats alone. Soon, knowledge networks connect.

**Other features:**
- 3D neural knowledge graph (Three.js)
- TipTap WYSIWYG editor with YouTube embed
- Draft generator (blog, Instagram, X thread, video script)
- Session hooks → daily logs → flush → wiki (Karpathy's compounding loop)
- FSRS memory decay tracking
- Batch ingest (whole folders), Quick Capture (N key)
- 50+ language search (multilingual embeddings)

```bash
npm install -g stellavault
stellavault init
stellavault graph
```

100% free, MIT, local-first. Your vault files are never modified.

GitHub: https://github.com/Evanciel/stellavault
Landing: https://evanciel.github.io/stellavault/

Would love your feedback! Especially from people with large vaults (1000+ notes).

---

## Reddit r/ClaudeAI

**Title:** Built an MCP server that gives Claude long-term memory from your Obsidian vault — with a P2P knowledge federation vision

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
- `federated-search` across connected peer vaults

**The compounding loop:** every session summary auto-saves to your vault → flush compiles into wiki → Claude reads the wiki next time → gets smarter about your project.

**What's next — Multiverse:**
The P2P federation layer is already built (Hyperswarm, trust/reputation system, differential privacy). Your vault becomes a "universe" in a larger knowledge network. Only embeddings are shared — your original text never leaves your machine.

The Multiverse view shows your universe and connected peers as neighboring constellations in 3D. Right now it says "Your universe floats alone — for now."

Free, MIT, local-first. `npm install -g stellavault`

GitHub: https://github.com/Evanciel/stellavault

---

## X/Twitter Thread

**1/** I built a self-compiling knowledge system.

Drop a PDF, paste a YouTube link, type a thought → it auto-organizes into a Zettelkasten wiki.

Claude accesses everything via MCP.

And there's a P2P Multiverse coming. 🧵

**2/** The pipeline (inspired by @kaborpa):

Capture → Organize → Distill → Express

Every input goes through the same flow. You never manually organize. Auto-wikilinks, auto-tags, auto-compile.

**3/** Ingest anything:
- PDF (unpdf)
- YouTube (transcript + timestamps via yt-dlp)
- DOCX/PPTX/XLSX
- URLs
- Drag & drop in browser
- Batch ingest (whole folders)

One command: `stellavault ingest <anything>`

**4/** Claude integration (MCP):

`claude mcp add stellavault -- stellavault serve`

Claude searches, asks, drafts, detects gaps, tracks memories — from YOUR vault.

generate-draft is free (no API key). Claude writes blog posts from your notes.

**5/** The compounding loop:

Session → session-save → daily-log → flush → wiki → MCP → Claude → better answers → repeat

Every conversation makes your knowledge base smarter.

**6/** 3D neural knowledge graph in your browser.

Right-click to add/connect/delete nodes.
TipTap WYSIWYG editor with YouTube embed.
Dark/light mode. Mobile PWA.

**7/** The Multiverse 🌌

Your vault = your universe. P2P federation connects universes.

Only embeddings shared — your text never leaves.
Trust + reputation system. Differential privacy.

"Your universe floats alone — for now."

The code is already built. Hyperswarm P2P ready.

**8/** Free. MIT. Local-first.
No cloud, no API key for core features.
50+ language search.
Vault files never modified.

```
npm install -g stellavault
```

GitHub: github.com/Evanciel/stellavault

---

## Hacker News

**Title:** Show HN: Stellavault – Local MCP server that gives Claude long-term memory, with P2P knowledge federation

**Body:**
Stellavault is a self-compiling knowledge system inspired by Andrej Karpathy's LLM knowledge base architecture.

Drop any file (PDF, YouTube, DOCX, XLSX) → auto-extracts text → compiles into Zettelkasten wiki with concepts and backlinks → Claude accesses via MCP.

The interesting part: there's a P2P federation layer (Hyperswarm) where vaults can connect as a "Multiverse." Only embeddings are shared, never original text (differential privacy). Each vault is a "universe" — the Multiverse view shows connected peers as neighboring constellations.

Tech: Node.js 20+, SQLite-vec, paraphrase-multilingual-MiniLM-L12-v2, Three.js, TipTap, FSRS.

Local-first, MIT, vault files never modified. 127 tests, code review 98/100.

npm install -g stellavault

https://github.com/Evanciel/stellavault

---

## Discord (Obsidian / Claude / PKM communities)

**Short version:**
Built Stellavault — self-compiling Obsidian knowledge system with MCP for Claude. Drop PDFs, YouTube, docs → auto-wiki → Claude accesses everything.

Vision: P2P Knowledge Multiverse — your vault becomes a universe, connecting with peers. Only embeddings shared. Hyperswarm P2P ready.

Free, MIT, local-first. Vault files never modified.

`npm install -g stellavault` | https://github.com/Evanciel/stellavault
