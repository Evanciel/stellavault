# Stellavault — Claude Code plugin

Give Claude Code long-term memory of your markdown vault (e.g. an Obsidian vault): local semantic search with zero API keys, FSRS memory decay, and vault-grounded answers.

```
/plugin marketplace add Evanciel/stellavault
/plugin install stellavault@stellavault
```

What you get:

- **Bundled MCP server** (auto-starts, via `npx -y stellavault serve`) — 21 tools: semantic search, ask-with-citations, related notes, gap/contradiction detection, decision journal, and more. Embeddings run locally; nothing leaves your machine.
- **`/vault-ask`** — answer questions grounded in your actual notes, cited as `[[Note Title]]`.
- **`/vault-review`** — what you're about to forget (FSRS decay) + one gap worth closing.
- **`/vault-decision`** — log ADRs with decision/rationale/alternatives; look up "why did we choose X?" later.

First run: point Stellavault at your vault once with `npx -y stellavault init` (interactive, ~3 min — builds the local index). Requires Node.js 20+.

Full project: https://github.com/Evanciel/stellavault · Docs: https://evanciel.github.io/stellavault/
