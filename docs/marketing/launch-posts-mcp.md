# 런치 포스트 초안 — MCP-as-distribution (2026-06-25, D1)

> 톤: 정직·로컬우선·MCP-네이티브. 과장 금지(0유저·솔로 사이드프로젝트). 링크는 게시 시점 확정.
> 핵심 1줄: "Obsidian 볼트를 Claude가 읽는 로컬 MCP 서버 — 원본 파일 미수정, API 키 0."
> (기존 일반 런치 카피는 launch-posts.md 참조)

---

## r/mcp
**제목:** Stellavault — a local-first MCP server that turns your Obsidian vault into Claude's memory (21 tools)

I built an MCP server that lets Claude search, ask, draft, and analyze my entire Obsidian vault — fully local, no API keys, never modifies my original files.

One command to connect:
```
npx -y stellavault setup   # Claude Code / Desktop, Cursor, Windsurf, or VS Code
```

Beyond plain search:
- **Hybrid retrieval** — semantic + BM25 + your [[wikilinks]] fused with weighted RRF, re-ranked by an FSRS memory-decay model (what you actually use resurfaces). 50+ languages, local embeddings.
- **Self-compiling wiki** — drop a PDF/YouTube/note → extracted to `raw/`, compiled into a linked `_wiki/`.
- **21 tools** — search, ask, drafts, gap/contradiction/duplicate detection, decision journal, snapshots, federated P2P search.

Solo side project (npm: `stellavault`), now on the MCP registry. Honest feedback on the tool surface + retrieval quality welcome.
GitHub: https://github.com/Evanciel/stellavault

---

## r/ClaudeAI
**제목:** I made Claude remember everything in my Obsidian vault — one command, fully local

Claude has the internet but not *your* notes. So I built a local MCP server that gives Claude (Code/Desktop) read access to my whole Obsidian vault — hybrid search, Q&A, draft generation, gap detection — on-device, no API keys, originals never touched.

`npx -y stellavault setup` wires it into Claude Code / Desktop / Cursor / Windsurf / VS Code.

There's also a desktop app (markdown editor + a 3D neural graph of your vault) for the GUI. Solo project, open source, feedback welcome.
https://github.com/Evanciel/stellavault

---

## r/ObsidianMD
**제목:** A local MCP server (+ desktop app) that turns your vault into an AI second brain — files never modified

Long-time Obsidian user. I wanted my AI assistant to actually *know* my vault without uploading it anywhere. Stellavault:
- runs **locally** (local embeddings, on-device vector store) — nothing leaves your machine,
- **never modifies your markdown** (reads + writes a separate index/`_wiki`),
- adds **hybrid search** (meaning + keyword + your [[links]]) and **FSRS memory decay** so forgotten notes resurface,
- exposes 21 tools to Claude via MCP.

It **layers on top of** your existing vault — not a replacement for Obsidian. Desktop app + CLI + a thin Obsidian plugin. Open source, free, solo-built. Honest critiques welcome.
https://github.com/Evanciel/stellavault

---

## Hacker News (Show HN)
**제목:** Show HN: Stellavault – Local MCP server that turns your notes into Claude's memory

A self-compiling, local-first knowledge base for Obsidian that Claude reads through MCP (21 tools). Hybrid retrieval (semantic + BM25 + wikilinks, weighted RRF) re-ranked by an FSRS memory-decay model; a 3D neural graph of your vault; everything on-device, no API keys, originals never modified.

`npx -y stellavault setup` connects it to Claude Code/Desktop, Cursor, Windsurf, or VS Code.

Solo side project — 0 users, honest about that. Most interested in feedback on (1) the retrieval design and (2) whether the MCP tool surface is the right shape. Stack: Node/TypeScript, SQLite-vec, local multilingual embeddings, React Three Fiber.
https://github.com/Evanciel/stellavault

---

## X / Twitter (thread)
1/ Claude has the internet. It doesn't have *your* notes.

Stellavault is a local-first MCP server that gives Claude read access to your entire Obsidian vault — search, ask, draft, analyze. No cloud, no API keys, your files are never modified.

`npx -y stellavault setup` 🧵

2/ Not just grep. Hybrid retrieval fuses semantic meaning + BM25 + your [[wikilinks]] (weighted RRF), then re-ranks by an FSRS memory-decay model — so the notes you're forgetting resurface. 50+ languages, fully local.

3/ Drop a PDF, a YouTube link, a half-formed thought → auto-extracted, then *compiled* into a clean wiki of linked concepts. Your knowledge re-organizes itself as it grows.

4/ Claude Code, Claude Desktop, Cursor, Windsurf, VS Code. Plus a desktop app with a 3D neural graph of your vault. Open source, solo-built.
→ https://github.com/Evanciel/stellavault
