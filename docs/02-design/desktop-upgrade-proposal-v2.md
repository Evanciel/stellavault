# Stellavault Desktop — Upgrade Proposal v2

> Synthesized from 6 adversarial audits (UX completeness, editor depth, core/AI engine, graph/perf, code-quality/security, competitive/strategic) cross-verified against real source. All line refs are real. Only CONFIRMED / PARTIAL findings are included; FALSE/already-handled items are in the Appendix.
>
> Baseline: desktop **v0.2.0** (Obsidian-parity Wave 0+1 + UX overhaul shipped).
> Date: 2026-06-14.

---

## 1. Executive Summary — Honest State of the App

### What is genuinely good (give credit)
v0.2.0 shipped a real, deep feature set — these are **not** gaps:
- **Editor**: WYSIWYG toolbar + Notion-style bubble menu, slash commands, real `[[wikilink]]` node with autocomplete/click-to-open/create-on-click (byte-faithful round-trip), Obsidian callout round-trip, lowlight code blocks, table insert + context bar, outline panel with bidirectional scroll sync, image paste/drop as base64.
- **App shell**: command registry + rebindable hotkeys, atomic+broadcast settings persistence, file-tree context menu (rename/duplicate/trash/new), hybrid full-text search panel, outline/tags/frontmatter panels, tab drag-reorder + dirty-close confirm + middle-click + Ctrl+Tab, session restore, daily-notes/calendar/bookmarks, Ask/Memory panel.
- **Security hardening**: `contextIsolation:true` + `nodeIntegration:false` + `sandbox:true`; preload runtime channel allowlist; `assertInsideVault` (resolve + `sep`-suffixed prefix, correct against sibling-prefix bypass); self-write echo guard; atomic settings write (tmp+rename); watcher flush re-entrancy guard; `create-file` exists-guard; `open-external` https-only.
- **Graph**: force-sim uses a correct uniform-grid (not O(n²)); throttled label projection; startup is well-structured (backgrounded core init, `ready-to-show`, lazy native modules).

### What is still weak (the real holes)
Three categories, kept distinct:

1. **Confirmed bugs / security (must fix):**
   - `vault:import-asset` **srcPath = arbitrary local-file read** into the vault (`main/index.ts:743`) — bypasses the entire path-safety model. Currently a dead branch (renderer uses base64) but live and untested.
   - **CJK word count is wrong on every keystroke** (`StatusBar.tsx:12`) — `content.split(/\s+/)` over the entire raw markdown *including frontmatter*; Korean has no spaces → ~1 "word" per line. Meaningless for this Korean-first user.
   - **Split-view Ctrl+S saves the wrong file** (`EditorArea.tsx:51-62`) — silent data loss.
   - **External-change conflict is invisible** (`runtime-sync.ts:76-82`) — `externallyChanged` set but read by no component; last-write-wins overwrites external edits with no warning.
   - No main-process `unhandledRejection`/`uncaughtException` handler — silent app death.
   - No `setWindowOpenHandler`/`will-navigate` guard (mitigated by sandbox; defense-in-depth gap).
   - **CI swallows test + audit failures** (`ci.yml:49,53,66`) — the one security test is non-gating; CRIT-A would not fail CI.

2. **Degraded / half-wired (works but underperforms):**
   - **Embedder hardcoded to English `all-MiniLM-L6-v2`** for a heavily-Korean vault (`main/index.ts:73,927`) — multilingual `paraphrase-multilingual-MiniLM-L12-v2` is a drop-in (same 384d, no reindex). *PARTIAL: user `.stellavault.json` can override the primary path; only the null-config fallback + smoke path are truly hardcoded.*
   - **Watcher full-vault reindex on every save** (`main/index.ts:786`) — `indexVault()` re-walks + re-hashes all files though the changed paths are known (`pending` Map at `:767`).
   - **`graph:build` O(n²) on the main thread, uncached, built twice** (`graph-data.ts:65-73`, `main/index.ts:625`) — freezes the window for ~2s when a graph opens; GraphView + GraphPanel each build independently.
   - **FSRS "review" == "open"** (`decay-engine.ts:79`) — no grading; the headline differentiator runs in name only.
   - **`getDecaying()` recomputes the whole table** per call (`decay-engine.ts:191`).
   - **askVault has no LLM** (`ask-engine.ts:18,62`) — the "Ask" panel is a labeled search list, not synthesis.
   - Panes/sidebar **not resizable** (dead store actions `app-store.ts:109,194`).

3. **Dormant moat (built in core, invisible in desktop — zero IPC hits):**
   `compileWiki`, `generateLearningPath`, `detectKnowledgeGaps`/`predictKnowledgeGaps`, `detectContradictions`, `detectDuplicates`, `insertWikilinks`/`autoLink`, decision-journal (`log-decision`/`find-decisions`/`get-evolution`), `lintKnowledge`, multi-vault search, `mountDashboard`/`mountPWA`, `createApiServer`. **The desktop ships ~30% of the core's capability.** The strategic threat (Atomic, June 2026: OSS, MCP read/write, wiki synthesis, 100k-node graph) is a near-clone of the thesis — racing Obsidian's plugin checklist is the wrong fight; surfacing the dormant engines is the differentiator.

---

## 2. Ranked Upgrade Backlog

Legend — Impact: High / Med / Low. Cost: S (≤½ day) / M (1–3 days) / L (week+).

### Tier 1 — Quick wins / bug & security (v0.2.x, next release)

> Bugs & security first, then cheap high-visibility polish.

| # | Item | Why (user impact) | Files | Cost | Deps |
|---|---|---|---|---|---|
| T1-1 | **Close `import-asset` srcPath file-read hole** | Arbitrary local-file → vault → readable via `vault:read-file`. Defeats path-safety model. Untested + unblocked by CI. | `main/index.ts:743` — delete the `srcPath` branch (renderer never uses it) or `assertInsideVault(vp, resolve(payload.srcPath))` | S | none |
| T1-2 | **Make CI gate tests + audit** | CRIT-A and any future security regression silently pass today. | `ci.yml:49,53` (drop `\|\| echo …skipped`), `:66` (drop `\|\| true`) | S | T1-3 (tests must actually pass) |
| T1-3 | **Real unit tests for security logic** | Only test is a regex-scrape of preload; `assertInsideVault`, import-asset sanitizer, `deepMerge`, settings validation are untested. | new `tests/*.test.ts`; targets in `main/index.ts:165-172,720-745`, `settings-store.ts:71-79` | M | none |
| T1-4 | **Main `unhandledRejection`/`uncaughtException` handlers** | Unguarded async IPC rejections crash the whole app (renderer ErrorBoundary doesn't cover main) → loss of unsaved work. | `main/index.ts` (top-level, near app init) | S | none |
| T1-5 | **`setWindowOpenHandler` deny + `will-navigate` guard** | Defense-in-depth; block navigation/window.open to non-app origins. | `main/index.ts:843-900` (createWindow) | S | none |
| T1-6 | **CJK-correct word/char count** | Wrong on every keystroke for a Korean user; counts frontmatter + syntax. | `StatusBar.tsx:12` — strip frontmatter + markdown tokens; count CJK by Intl.Segmenter/grapheme, latin by `\s+`; add char count | S | none |
| T1-7 | **Split-view Ctrl+S saves the focused pane** | Editing the split pane + Ctrl+S silently saves the wrong file (data loss). | `EditorArea.tsx:51-62` — track focused pane, save it | S | T1-8 helps |
| T1-8 | **External-change badge + reload bar** | Silent divergence / overwrite of external (sync daemon, Obsidian) edits — the data-trust hole the category exists to prevent. | `runtime-sync.ts:76-82` (flag already set), surface in `TabBar.tsx` (badge) + `EditorArea.tsx` ("reload / keep mine" bar) | S–M | none |
| T1-9 | **Resizable sidebar/right panel (drag handle)** | The single most noticeable "feels unfinished" tell; actions already exist, unwired. Persist into settings. | new drag-handle cmpt; `App.tsx:158-216`; wire `setSidebarWidth`/`setRightPanelWidth` (`app-store.ts:109,194`); persist via `settings:set` | S | settings slice |
| T1-10 | **Switch embedder to multilingual** | Korean semantic search silently degraded vs CLI; multilingual MiniLM is 384d → drop-in, no reindex. (PARTIAL: only fixes fallback+smoke; primary path is config-driven.) | `main/index.ts:73,927` → `paraphrase-multilingual-MiniLM-L12-v2`; verify dim at `local-embedder.ts:36` | S | none |
| T1-11 | **`getDecaying` read-only path** | Showing 5 decaying notes rewrites the whole decay table. | `decay-engine.ts:191` → use `getRetrievabilityForDocs` (`:218`) for top-N | S | none |
| T1-12 | **Save write-failure feedback** | `vault:write-file` reject → no error, unhandled (with T1-4). | `EditorArea.tsx:51-56` — try/catch + toast | S | T1-4 |
| T1-13 | **Validate/clamp settings patch + guard config parse** | Poisoned `settings:set` (negative window size) persists & re-applies; malformed `~/.stellavault.json` blocks startup with no fallback. | `main/index.ts:26` (try/catch JSON.parse → picker), `:672-677` + `settings-store.ts:71-79` (clamp width/height, validate types) | S | none |
| T1-14 | **Code block: language picker + copy button** | Standard in Notion/Obsidian; cheap NodeView. | `MarkdownEditor.tsx:61` (CodeBlockLowlight NodeView) | S | none |
| T1-15 | **Graph slider settings persisted** | Repel/Link/Center/Distance reset every graph reopen; user re-tunes constantly. | `GraphView.tsx:388` → add `graph` settings slice via existing `settings:set` IPC (`main/index.ts:668-677`) | S | settings slice |
| T1-16 | **Bump release Node 20 → 22** | Node 20 EOL 2026-04; release build on soon-deprecated runtime. | `desktop-release.yml:52`, `ci.yml:14` | S | none |

### Tier 2 — Feature depth (v0.3)

| # | Item | Why | Files | Cost | Deps |
|---|---|---|---|---|---|
| T2-1 | **Custom asset protocol → vault-relative images render** | `![](assets/x.png)` is broken in-editor (only base64 renders) — biggest "feels broken" editor gap. | register privileged `app://vault/...` protocol in main (no `registerFileProtocol` today); rewrite img src on render; `main/index.ts:857-896`, `MarkdownEditor.tsx:194` | M | T1-5 (origin policy) |
| T2-2 | **Targeted incremental reindex** | Editing one note re-scans + re-hashes the entire 8k+ vault per save; UI stutter, DoS-ish under sync-daemon load. | new core `indexFiles(paths[])`; watcher passes `batch` (`main/index.ts:786`, `pending` `:767`); core `indexer/index.ts:48` | M | core API |
| T2-3 | **Reading/source-mode toggle** | WYSIWYG-only; no way to view/verify raw markdown (math/HTML spans). Obsidian/Notion staple. | `MarkdownEditor.tsx` + toolbar; mode state in editor area | M | none |
| T2-4 | **Find & replace in note** | No in-note Ctrl+F; table-stakes for long notes. | new search-in-note overlay over editor | M | none |
| T2-5 | **Real FSRS grading (Again/Hard/Good/Easy)** | "Review" == "open" → spaced repetition can't space; headline differentiator runs in name only. | core: add `grade?:1\|2\|3\|4` to `AccessEvent`, branch `recordAccess` stability (`decay-engine.ts:60,76`); desktop review UI → `core:record-access` | M | core API |
| T2-6 | **Surface gaps + learning-path "Coach" panel** | Strongest unused differentiator; "what you don't know" + "review these 5" = retention engine, demo wow. No competitor has FSRS+gaps. | new IPC for `detectKnowledgeGaps`/`generateLearningPath`/`predictKnowledgeGaps` (`server.ts:79-80,147-150`); new panel | M | none |
| T2-7 | **`graph:build` cache + worker** | Main-thread freeze ~2s on graph open, built twice (GraphView + GraphPanel). | cache by index version (`main/index.ts:625-636`); ideally move O(n²) to utility/worker process (`graph-data.ts:65-73`); single shared build | M | none |
| T2-8 | **Async/chunked full-vault FS scans** | `backlinks:find` reads every .md sync on note-open; `vault:update-links` rewrites whole vault on rename → UI jank on big vaults. | `main/index.ts:639-665,359-411,141-158` — async + cache, or read from core index | M | T2-2 helps |
| T2-9 | **Graph 2D mode + zoom-adaptive labels** | 3D harder to read (Obsidian is 2D default); only 18 labels in GraphView, none in GraphPanel — legibility gap. | sim z=0 flag + ortho camera; label count scales with zoom; `force-sim.ts`, `GraphView.tsx:241`, `GraphPanel.tsx` | M | none |
| T2-10 | **GraphPanel hover perf parity** | Rebuilds `nodeMap` + edge buffers + React re-render on every pointermove → jank. GraphView already solved this. | adopt `litLinksRef`/drawRange pattern from `GraphView.tsx:107-118` in `GraphPanel.tsx:115-136` | M | none |
| T2-11 | **File-tree keyboard nav + DnD move** | No arrow/Enter nav, no "Move to…"/drag between folders; daily-driver friction. | `FileTree.tsx:254-298` (key handlers, draggable rows + drop targets, "Move to…" in context menu) | M | none |
| T2-12 | **Bundle: `manualChunks` + lazy-load graph** | three/drei/fiber + tiptap ship in one chunk loaded at startup though graph isn't on the startup path → parse/compile cost. | `vite.renderer.config.ts:24-28` manualChunks (`three`/`tiptap`/`vendor`); `React.lazy` the graph view | S (chunks) / M (lazy) | none |
| T2-13 | **`[[Note#heading]]` anchor navigation** | Clicking strips the anchor and opens at top; scroll-to-heading machinery exists but only driven by OutlinePanel. | `WikilinkNode.ts:51` (stop stripping `#`); reuse scroll-to-heading (`MarkdownEditor.tsx:149`); heading suggestions (`WikilinkSuggestion.ts:151`) | M | none |
| T2-14 | **Math UX: local KaTeX CSS + real node** | `mathBlock` node is dead code; KaTeX CSS from remote CDN (offline-fail, CSP/privacy); rendered widget overlays raw `$$` text. | bundle KaTeX CSS locally (`MathExtension.ts:23`); instantiate `mathBlock` via command/input rule (`:57`); clean source↔render swap | M | none |
| T2-15 | **Wire decayEngine into search recency** | If hub's `getDecayEngine` isn't the same instance, desktop loses the ±10% B3 recency re-rank (MEMORY.md flags this). | verify `createKnowledgeHub` wiring vs standalone `new DecayEngine` (`main/index.ts:93`, `search/index.ts:51,80-91`) | S | none |
| T2-16 | **Unify quick-switcher + command palette** | Two modals (`mod+p` / `mod+shift+p`) users won't discover; offer "go to file" from command bar. | `QuickSwitcher` + `CommandPalette.tsx:72` | S–M | none |
| T2-17 | **Warn on editor-native hotkey binds** | User can bind `mod+b/i/e` (TipTap owns them) → silently does nothing while editing. | `SettingsModal.tsx:214` (extend `findConflicts` with editor-chord set) | S | none |
| T2-18 | **Main-side dirty-close dialog** | `beforeunload` is silently suppressed in Electron → clicking X does nothing, no explanation; combined with manual-only save = top data-loss path. | `window:close-request` round-trip + `dialog.showMessageBox` (Save/Discard/Cancel); `session-persist.ts:116-124`, main | M | T1-4 |

### Tier 3 — Strategic / differentiating (v0.4+)

| # | Item | Why | Files | Cost | Deps |
|---|---|---|---|---|---|
| T3-1 | **Wiki Synthesis panel** | The one AI feature that beats Obsidian AND Atomic head-on; Atomic's maker calls it the "killer differentiator." Engine already built. | wire `compileWiki`/`extractConcepts` (`intelligence/wiki-compiler.ts`, exported `core/src/index.ts:67`) → "Synthesize" panel rendering cited `[[backlink]]` article | S (wiring) | T2-1 (link render) |
| T3-2 | **LLM synthesis for Ask** | Turns the headline AI feature from a search list into a real answer; keep extractive as no-key fallback. | pluggable `Synthesizer` over `ask-engine.ts`; `core:ask` (`main/index.ts:533-541`); user already has API keys | L | none |
| T3-3 | **"Agent Memory" positioning + MCP server toggle** | The real 2026 wedge: local FSRS-pruned memory agents read/write. MCP server exists (21 tools) but isn't a first-class desktop story. | start/stop MCP toggle; live "Claude wrote/searched X" feed; `createMcpServer` (core) | S–M | T2-5 (pruning) |
| T3-4 | **Web clipper** | The only true *missing* table-stakes capture gap (sync pkg is a Notion daemon, not a clipper); "second brain" has no front door. | browser extension → local endpoint via dormant `createApiServer` (`core/src/api/`) → auto-embed + decay | M | none |
| T3-5 | **Decision-journal / ADR capture UI** | User's whole workflow is ADR-centric (global CLAUDE.md auto-ADR); engines are MCP-only. | IPC for `log-decision`/`find-decisions`/`get-evolution` (`server.ts:130-133,153`) + capture UI | M | none |
| T3-6 | **Auto-linker "link these mentions"** | Flagship Obsidian-parity feature sitting unused; suggest `[[wikilinks]]` from vault titles while editing. | wire `insertWikilinks`/`autoLink` (`auto-linker.ts:81,133`) into editor | S–M | none |
| T3-7 | **Local Publish / read-only PWA** | Obsidian charges $8/mo for Publish; dormant PWA+dashboard already exist; doubles as a mobile on-ramp. | wire `mountDashboard`/`mountPWA` (`core/src/api/`) → desktop "Publish (read-only)" | S–M | none |
| T3-8 | **Contradiction + duplicate nudges** | High-signal "3 near-duplicate notes" / "these contradict"; no competitor surfaces this. | wire `detectContradictions`/`detectDuplicates` → notifications/panel | M | none |
| T3-9 | **Multi-vault switcher + cross-vault search** | Core supports it; desktop is hardwired single-vault — work/personal can't be searched together. | wire `multi-vault/index.ts` (add/remove/list + cross search); vault switcher UI | M | none |
| T3-10 | **Embeds / transclusion `![[ ]]`** | Core Obsidian composition feature; not implemented. | `markdown.ts:338` (match `![[`) + transclusion render | L | T2-1 |
| T3-11 | **Drag-drop block reorder** | Notion's signature interaction; pure WYSIWYG feels dated without it. | `GlobalDragHandle` extension in `MarkdownEditor.tsx` | L | none |
| T3-12 | **Auto-update channel** | No in-app update path; can't push the T1-1 fix to installed users. | `update-electron-app`/Squirrel feed + signed builds; `desktop-release.yml` | L | code signing |

---

## 3. Recommended "Do Next" Shortlist (approve to start)

Optimized for: kill confirmed bugs/security first, then the cheapest highest-visibility wins, then one strategic wiring that needs near-zero build.

1. **T1-1 + T1-2 + T1-3 — Security bundle** (S+S+M): delete/guard the `import-asset` srcPath read, make CI actually gate tests + audit, and add real unit tests for `assertInsideVault`/import-asset/settings. One coherent PR; closes the only Critical and the test/CI gap that let it through.
2. **T1-6 CJK word count** (S): visibly wrong on every keystroke for *this* Korean user — trivial, high-trust fix.
3. **T1-7 + T1-8 split-save + external-change badge** (S/S–M): two silent data-loss paths; the data-trust holes the category exists to prevent.
4. **T1-9 resizable panes + T1-15 graph settings persist** (S+S): the biggest "half-finished" tells; the store actions already exist, just unwired.
5. **T3-1 Wiki Synthesis panel** (S, wiring only): the single most defensible AI feature in the 2026 landscape (beats Obsidian *and* Atomic), and the engine is already built in core — highest leverage = impact ÷ cost.

Strategic note: interleave T1-10 (multilingual embedder) into bundle #1 if a reindex window is acceptable — it's a one-line drop-in that fixes Korean search quality. Defer T2/T3 feature builds until the Tier-1 bug/trust surface is clean.

---

## Appendix — Verified-FALSE / already-handled (do NOT re-open)

- **Force-sim is O(n²):** FALSE. Uniform-grid with hard distance² cutoff is correct (`force-sim.ts:1-4,117-160`); per-frame GC/buffer overhead is the only (Med) concern, not the math.
- **`assertInsideVault` sibling-prefix bypass (`vault-evil`):** Already handled — `resolve` + `sep`-suffixed prefix check (`main/index.ts:165-172`).
- **`shell:open-external` arbitrary scheme:** Already https-only (`:707-712`); `open-path` vault-restricted (`:700-704`).
- **`import-asset` *target* traversal:** Already handled — basename strip + ext allowlist + size cap + `assertInsideVault(target)` (`:723-740`). Only the *source* (T1-1) is unguarded.
- **WikilinkSuggestion `innerHTML` XSS:** Safe — uses `escapeHtml` (`WikilinkSuggestion.ts:72`). (SlashCommands `:109-112` is unescaped but static built-in defs only — latent footgun, not exploitable; note in T1-3 scope.)
- **Settings write not atomic:** Already handled — tmp+rename (`settings-store.ts:101-110`).
- **Startup regression:** None — backgrounded core init, `ready-to-show`, `show:false`, lazy native modules (`main/index.ts:872,984-990`).
- **Embedder "silently degraded regardless of config":** PARTIAL/over-claimed — user `.stellavault.json` overrides the primary path; only the null-config fallback (`:73`) and one-shot CLI smoke (`:927`) are truly hardcoded. (Still worth T1-10.)
- **`script-src` injection:** Locked — no inline `script-src`, falls back to `default-src 'self'`. Only `style-src 'unsafe-inline'` remains (deliberate; Low).
- **Federation surfaced/broken:** Correctly dormant + off-by-default per project policy; no action.
- **`OrbitControls` from drei bloats bundle:** Low — tree-shaking mostly handles it; swapping to three's own controls is M-cost for Low gain. Deprioritized.
