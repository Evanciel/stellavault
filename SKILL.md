---
name: stellavault
description: >-
  Search, recall, and reason over the user's personal knowledge base — their
  Obsidian/Markdown vault — via the Stellavault MCP server. Use whenever the
  user refers to their own notes, past decisions, or accumulated knowledge:
  "search my notes", "what do I know about X", "what did I decide about Y",
  "from my vault", "my second brain", "recall", "didn't I write about",
  내 노트에서, 볼트에서 찾아, 예전에 정리한, 기억나, 내가 뭐라고 했더라,
  ノートを検索, ボルトから, 私のメモ, 笔记中搜索, 我的知识库.
  Do NOT use for general web knowledge or for files in the current repo.
---

# Stellavault — the user's second brain, inside Claude

Stellavault indexes the user's Obsidian/Markdown vault locally (vector + BM25 +
entity-linking hybrid search, fully on-device — no data leaves the machine) and
exposes it over MCP. When the user asks about *their own* knowledge, prefer these
tools over guessing or web search.

## When to use

- The user references their own notes, vault, or "second brain".
- They ask what they previously wrote, learned, or decided.
- They say "recall", "remind me", "didn't I note…", or use the Korean/JP/CN
  equivalents in the description triggers.
- Before answering a personal/project question that their notes likely cover.

## Key MCP tools (server name: `stellavault`)

- **search** — hybrid retrieval (semantic + keyword + entity). Start here for
  "find / what do I know about …".
- **ask** — retrieve + compose a grounded answer from the vault.
- **get-related** — neighbors of a note (knowledge-graph expansion).
- **list-topics** — tag/topic overview of the vault.
- **find-decisions** / **log-decision** — query or append the decision journal (ADRs).
- **get-decay-status** / **get-morning-brief** — what the user is forgetting (FSRS).
- **detect-gaps**, **get-evolution**, **generate-claude-md** — knowledge analysis.

## Setup (one time)

```bash
npm install -g stellavault
stellavault init            # pick vault, index it, optionally connect clients
stellavault setup           # or connect clients later (Claude Code/Desktop, Cursor, Windsurf, VS Code)
```

`setup` registers Stellavault as an MCP server in each detected client. Restart
the client afterward. Everything runs locally; embeddings use a local model, so
no API key is required and no note content is sent to any server.
