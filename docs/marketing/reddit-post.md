# Reddit r/ObsidianMD Post Draft

**Title:** I built Stellavault — your vault's memory shouldn't be better than yours

---

Hey everyone,

I've been using Obsidian for years and kept running into the same problem: I write great notes, then completely forget they exist. Sound familiar?

So I built **Stellavault** — a plugin that adds knowledge intelligence to your vault:

## What it does

- **Semantic Search** — Find notes by *meaning*, not just keywords. "What did I write about productivity systems?" actually works, even if you never used the word "productivity." Powered by local AI embeddings — no API calls, no data leaving your machine.

- **Memory Decay Tracking** — Uses the FSRS spaced repetition algorithm (same one Anki uses) to track which notes are fading from your memory. A sidebar shows your "forgetting curve" in real-time.

- **Learning Paths** — Based on your decay patterns and knowledge gaps, suggests what to review next. Like a personal tutor for your own notes.

- **Auto-indexing** — Changes are indexed in real-time. No manual rebuilds.

## Privacy-first

Everything runs locally. SQLite database + local embeddings. Zero network calls. Your notes never leave your machine.

## How to try it

Manual install for now (community plugin review pending):
1. Download from [GitHub Releases](https://github.com/Evanciel/stellavault-obsidian/releases/tag/0.1.0)
2. Copy `main.js`, `manifest.json`, `styles.css` to `.obsidian/plugins/stellavault/`
3. Enable in Settings

Also available as a CLI tool: `npx stellavault` — works with MCP for Claude integration.

## Also included

- **3D Knowledge Graph** — Visualize your vault as a neural network in 3D space. Clusters form constellations. Zoom to explore.
- Works as a **Claude Code MCP server** too — `npx stellavault serve` lets AI agents search your knowledge.

## What's next

- Federated knowledge sharing (opt-in P2P, embedding-only, no raw text)
- Knowledge packs (share curated knowledge bundles)

Would love feedback. What features would make this useful for your workflow?

GitHub: https://github.com/Evanciel/stellavault-obsidian
