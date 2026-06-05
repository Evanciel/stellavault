# Stellavault Execution Runbook — Release 0.8.0, Reindex, MCP Setup

> Status: ready to execute. Three independent real-environment tasks.
> Repo root: `E:/AI코딩프로젝트/클로드코드/notion-obsidian-sync` · Branch: `master` (clean, up to date with origin).
> Generated: 2026-06-05. Verified against live working tree and live `~/.stellavault.json`.
>
> **STOP gates in this doc:**
> - Section 1, Step R7 — `npm publish` is **irreversible** and requires explicit user confirmation.
> - Section 2 and 3 mutate real files on disk; back up first (steps spell out exact paths).

---

## 0. Pre-flight (shared)

```powershell
# from repo root
git status              # must be clean
git pull               # pick up any teammate changes first
node --version         # must be >= 20
npm whoami             # must print your npm username (needed for publish)
```

Current verified state:

| Item | Value |
|------|-------|
| Root `stellavault` version | `0.7.4` |
| `@stellavault/core` | `0.7.4` |
| `@stellavault/cli` | `0.7.4` |
| `@stellavault/graph` | `0.7.4` (private) |
| `@stellavault/sync` | `1.0.0` (private, independent) |
| Latest git tag | `v0.7.4` |
| CHANGELOG top entry | `## [0.7.4] - 2026-05-13` |
| Unreleased commits since v0.7.4 | `8a5ff6f` `94e718c` `fb29248` `d5931de` `bcebfa1` |

---

## 1. RELEASE — Stellavault 0.8.0

### 1.1 SemVer recommendation: **0.8.0** (MINOR), not 0.7.5 (PATCH)

**Decision: bump to `0.8.0`.**

Rationale (SemVer 2.0.0, Rule 7 — "MINOR MUST be incremented if new, backward-compatible
functionality is introduced to the public API"; PATCH is reserved for bug fixes to existing
behavior only):

The unreleased commits add **new, backward-compatible features**, not just fixes:

- **4-stage upgrade** (`8a5ff6f`, hardened in `94e718c`/`fb29248`) — env-respecting DB path
  resolution, decay index, watcher hook, gap cache. New `STELLAVAULT_DB_PATH` precedence is
  additive (falls back to prior behavior when unset).
- **Upgrade A — one-command setup** (`bcebfa1`) — new `stellavault setup` command writing MCP
  config for 5 clients, new `SKILL.md`, `init-cmd` additions. New public CLI surface.
- **Upgrade B — entity-linking + adaptive rerank** (`bcebfa1`) — new entity extractor, new
  `chunk_entities` table, entity search as a 3rd RRF signal, adaptive reranking wired into the
  MCP search tool. New search behavior, backward compatible (existing indexes keep working;
  entities populate on next reindex).
- **B3 — adaptive rerank → MCP wiring + smoke coverage** (`bcebfa1`) — `+21` smoke assertions,
  search tool emits the new ranking.

None of these remove or break a public API in a way that forces a MAJOR bump (no public
contract removal beyond the already-shipped 0.7.4 federation break). Therefore **MINOR (0.8.0)**
is correct.

> Note on `@stellavault/sync` (`1.0.0`): it versions independently and is `private`, so it is
> **NOT** part of this release and does **NOT** bump to 0.8.0. Leave it at `1.0.0`.

### 1.2 Exact files to bump (4 files, must stay in sync — bundled-workspace rule)

The bundler injects the version from **root `package.json`** at build time
(`scripts/bundle-cli.mjs` → `__SV_VERSION__` define), so the root file is load-bearing. The
three workspace files must match it so published/consumed metadata is consistent.

| File | Line | Change |
|------|------|--------|
| `package.json` (root) | 3 | `"version": "0.7.4"` → `"version": "0.8.0"` |
| `packages/core/package.json` | 3 | `"version": "0.7.4"` → `"version": "0.8.0"` |
| `packages/cli/package.json` | 3 | `"version": "0.7.4"` → `"version": "0.8.0"` |
| `packages/graph/package.json` | 3 | `"version": "0.7.4"` → `"version": "0.8.0"` |

Do **not** touch `packages/sync/package.json` (stays `1.0.0`) or `packages/desktop` (separate
release track).

Verify all four are in sync after editing:

```powershell
node -p "require('./package.json').version"
node -p "require('./packages/core/package.json').version"
node -p "require('./packages/cli/package.json').version"
node -p "require('./packages/graph/package.json').version"
# all four must print 0.8.0
```

### 1.3 CHANGELOG.md entry draft

Insert this block at the **top of `CHANGELOG.md`**, immediately after the `# Changelog`
heading and **before** `## [0.7.4] - 2026-05-13`. Keep all prior entries intact. Format follows
Keep a Changelog (grouped by type) + ISO 8601 date.

```markdown
## [Unreleased]

## [0.8.0] - 2026-06-05

### Added
- **One-command MCP setup** (`stellavault setup`) — auto-detects and writes MCP config for 5
  clients: Claude Code (via `claude mcp add -s user`), Claude Desktop, Cursor, Windsurf, and
  VS Code. Flags: `-c/--client <id>` (repeatable), `--all` (write all clients regardless of
  detection), `--command`, `--args`. Idempotent: file clients merge only the `stellavault`
  entry; Claude Code uses remove-then-add. Adds `SKILL.md` for assistant onboarding (A1/A2/A3).
- **Entity-linking search signal** — new entity extractor (wikilinks `[[...]]`, `#tags`,
  headings, title, Title-Case / ALL-CAPS noun-phrase fallback; Korean supported; cap 30
  entities/chunk). New `chunk_entities` table (FK `ON DELETE CASCADE` to `chunks`). Entity match
  added as a **3rd RRF signal** alongside semantic + keyword search.
- **Adaptive reranking wired into MCP** — the MCP `search` tool now emits the adaptively
  reranked ordering. `+21` smoke assertions cover the new path.
- **4-stage upgrade** —
  - **DB path resolution** now respects `STELLAVAULT_DB_PATH` env (precedence: env →
    `config.dbPath` → vault-hash fallback `~/.stellavault/vaults/<hash>.db`).
  - **Decay index** for FSRS-style staleness tracking.
  - **Watcher hook** for incremental updates.
  - **Gap-detection cache** (generation-bound inflight to avoid stale-return races).

### Changed
- MCP `search` result ordering changed to adaptive rerank (more relevant top hits). Backward
  compatible — callers receive the same result shape.

### Fixed
- Gap-cache stale-return race under concurrent calls — generation-bound inflight + db-keyed
  singleflight (`94e718c`, `fb29248`).
- Search-decay interaction bug surfaced during the upgrade sweep.

### Housekeeping
- `.gitignore`: PowerShell `ModuleAnalysisCache` artifact (`d5931de`).

### Notes
- **Real vaults must be reindexed** for the new entity signal (Upgrade B) to populate
  `chunk_entities`. See the REINDEX runbook (Section 2). Existing indexes keep working without
  reindex; they simply won't have entity hits until reindexed.

### Tests
- `@stellavault/core`: **206 → 223** PASS (entity-extractor + entity-search suites).
- `tests/smoke.mjs`: **11 → 12** files / `+21` assertions.

### Commits
`8a5ff6f` `94e718c` `fb29248` `d5931de` `bcebfa1`
```

> Replace the `+21 assertions` / `223` figures with the exact numbers your `npm test` and
> `node tests/smoke.mjs` print at release time if they differ.

### 1.4 Build + pack + publish checklist

Run from repo root, in order. Do **not** proceed past a failing step.

```powershell
# R0 — tests green first
npm run test --workspaces --if-present
node tests/smoke.mjs        # expect 12 files / ALL PASS

# R1 — edit the 4 version files + CHANGELOG (sections 1.2 / 1.3), then confirm sync
node -p "require('./package.json').version"   # 0.8.0 (repeat for core/cli/graph)

# R2 — clean build (graph first so dist/graph-ui is bundled, then bundle CLI)
npm run build               # = build --workspaces --if-present && bundle

# R3 — verify the injected version landed in the bundle
Select-String -Path dist/stellavault.js -Pattern "0\.8\.0" | Select-Object -First 1
#   (bundle-cli injects __SV_VERSION__ from root package.json; must show 0.8.0)

# R4 — DRY-RUN the tarball (no upload, exercises prepack/postpack hooks)
npm pack --dry-run
#   prepack.mjs strips `workspaces` + devDependencies + scripts (backup: package.json.prepack-backup)
#   postpack.mjs restores package.json — confirm git status is clean again afterward
git status                  # must be clean (postpack restored package.json)

# R5 — inspect tarball contents match the `files` allow-list
#   expected: dist/stellavault.js, dist/graph-ui/**, README.md, SKILL.md, LICENSE, SECURITY.md
npm pack
tar -tzf stellavault-0.8.0.tgz
Remove-Item stellavault-0.8.0.tgz   # discard the test tarball

# R6 — commit + tag (DO THIS BEFORE PUBLISH so the published version is reproducible)
git add package.json packages/core/package.json packages/cli/package.json packages/graph/package.json CHANGELOG.md
git commit -m "chore(release): 0.8.0"
git tag v0.8.0
git push origin master --tags
```

```powershell
# R7 — PUBLISH  ⚠️ IRREVERSIBLE — REQUIRES EXPLICIT USER CONFIRMATION ⚠️
#   npm version+name combos are permanent: once 0.8.0 is published it can never be reused,
#   even after `npm unpublish`. Do NOT run this without the user saying "yes, publish".
#   If 2FA is enabled on the npm account, append --otp=<6-digit-code>.
#
#   Only the ROOT package (`stellavault`) is published. core/cli/graph are bundled into
#   dist/stellavault.js and/or marked private — they are NOT published separately.
npm publish                 # add --otp=<code> if 2FA; add --tag next for a pre-release

# R8 — post-publish verification
npm view stellavault@0.8.0 version
npx --yes stellavault@0.8.0 --version    # should print 0.8.0
```

**Release gotchas (act on these):**
- `npm publish` is irreversible — gate on user confirmation (R7).
- If `npm whoami` is empty → `npm login` first; publish will otherwise fail.
- 2FA: a missing `--otp` flag fails the publish. Have the code ready.
- The `files` allow-list in root `package.json` controls the tarball — verify in R5; don't
  rely on `.npmignore`.
- `prepack.mjs` rewrites `package.json` during pack/publish; `postpack.mjs` restores it. After
  any pack/publish, re-check `git status` is clean (R4).
- Bundle version is injected at **build** time — never publish without rebuilding after the
  version bump (R2 before R7).

---

## 2. REINDEX — real `F:/Obsidian/Evan` vault (populate B2 entities)

> **Critical correction vs. generic notes:** the live vault is `F:/Obsidian/Evan` and the live
> DB is **`F:\Obsidian\Evan\.stellavault.db`** — confirmed from `~/.stellavault.json`
> (`vaultPath: "F:/Obsidian/Evan"`, `dbPath: "F:\\Obsidian\\Evan\\.stellavault.db"`).
>
> DB-path precedence (`index-cmd.ts::resolveDbPath`): `STELLAVAULT_DB_PATH` env →
> `loadConfig().dbPath` → vault-hash fallback. With no env set and an empty project
> `.stellavault.json`, `loadConfig()` reads `~/.stellavault.json`, so the **config DB wins**.
> The files under `~/.stellavault/vaults/` (`3d896717.db` = hash of `E:/obsidian/Evan`,
> `6438b442.db` = hash of `F:/Obsidian/Evan`) are **stale/secondary** and are NOT what a plain
> `stellavault index` writes to. Do not reindex those.

Verified live DB: `F:\Obsidian\Evan\.stellavault.db` — ~176 MB, modified 2026-06-05, active WAL
(`-wal` / `-shm` present → DB is in WAL mode and possibly open).

### 2.1 Back up the live DB first (Windows, absolute paths)

Close any running stellavault / MCP server first so the WAL is checkpointed and the copy is
consistent (otherwise copy all three of `.db`, `.db-wal`, `.db-shm` together).

```powershell
# stamped backup of the live DB + WAL sidecars (copy all three to be safe)
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item "F:\Obsidian\Evan\.stellavault.db"     "F:\Obsidian\Evan\.stellavault.db.$ts.bak"
if (Test-Path "F:\Obsidian\Evan\.stellavault.db-wal") { Copy-Item "F:\Obsidian\Evan\.stellavault.db-wal" "F:\Obsidian\Evan\.stellavault.db-wal.$ts.bak" }
if (Test-Path "F:\Obsidian\Evan\.stellavault.db-shm") { Copy-Item "F:\Obsidian\Evan\.stellavault.db-shm" "F:\Obsidian\Evan\.stellavault.db-shm.$ts.bak" }
Get-Item "F:\Obsidian\Evan\.stellavault.db.$ts.bak" | Select-Object Length, LastWriteTime
```

### 2.2 Run the reindex (incremental; entities populate on changed/new files)

The indexer is **incremental** (content-hash diff; unchanged files skipped, deleted files
removed). Entity extraction runs at index time and writes `chunk_entities` only for chunks that
get (re)written.

```powershell
# No path arg needed — it resolves vault + DB from ~/.stellavault.json.
stellavault index --verbose
#   equivalently explicit: stellavault index "F:/Obsidian/Evan" --verbose
#   CI/log-friendly (no spinner): stellavault index --no-spinner
#   capture skips/failures:       stellavault index --verbose --log-skipped "F:/tmp/sv-skipped.json"
```

> **Caveat (B2 backfill):** incremental reindex skips files whose **content** is unchanged, so
> entities are only extracted for changed/new files. To force a **full** entity backfill across
> the whole vault, the content hashes must change — the clean way is to reindex into a fresh DB:
>
> ```powershell
> # OPTIONAL full rebuild (only if you need entities on EVERY existing note now):
> $env:STELLAVAULT_DB_PATH = "F:\Obsidian\Evan\.stellavault.fresh.db"
> stellavault index "F:/Obsidian/Evan" --verbose
> # verify (see 2.3), then swap: stop servers, back up old, replace .stellavault.db with the fresh one
> Remove-Item Env:\STELLAVAULT_DB_PATH
> ```

### 2.3 Post-checks — confirm B2 entities populated

```powershell
# (a) index stats — document/chunk counts + last-indexed timestamp
stellavault status

# (b) chunk_entities row count on the LIVE DB (expect total > 0)
sqlite3 "F:\Obsidian\Evan\.stellavault.db" "SELECT COUNT(*) AS total, COUNT(DISTINCT chunk_id) AS chunks_with_entities FROM chunk_entities;"
#   total must be > 0; chunks_with_entities > 0. If 0 → entities did NOT populate (see rollback).

# (c) functional check — entity-aware search returns hits for a known wikilink/tag/title
stellavault search "<a tag or [[wikilink]] you know exists in the vault>"
#   results should surface chunks containing that entity.
```

If `sqlite3` is not on PATH, the `stellavault status` counts plus a successful entity search in
(c) are sufficient acceptance evidence.

### 2.4 Rollback

```powershell
# restore the live DB from the stamped backup (use the $ts you created in 2.1)
Copy-Item "F:\Obsidian\Evan\.stellavault.db.$ts.bak" "F:\Obsidian\Evan\.stellavault.db" -Force
# also restore -wal/-shm .bak if you copied them; or delete stale -wal/-shm so SQLite rebuilds them
```

Reindex is incremental and non-destructive to unchanged data, so rollback is rarely needed —
but the backup makes it a one-liner.

---

## 3. SETUP — write MCP client configs (`stellavault setup`)

> No `--dry-run` flag exists. Writes are **idempotent** (file clients merge only the
> `stellavault` key; Claude Code does remove-then-add) but there is **no automatic backup** —
> back up existing files yourself (3.1).

### 3.1 Back up existing client configs first (absolute Windows paths)

Verified on this machine: **only Claude Desktop's config exists today**; Cursor / Windsurf /
VS Code configs are absent (setup will create them fresh — nothing to back up, but listed for
completeness). Claude Code config is managed by the `claude` CLI.

```powershell
$ts = Get-Date -Format "yyyyMMdd-HHmmss"

# Claude Desktop — EXISTS, back it up
$cd = "C:\Users\KHS\AppData\Roaming\Claude\claude_desktop_config.json"
if (Test-Path $cd) { Copy-Item $cd "$cd.$ts.bak" }

# Cursor — absent today, but guard anyway
$cu = "C:\Users\KHS\.cursor\mcp.json"
if (Test-Path $cu) { Copy-Item $cu "$cu.$ts.bak" }

# Windsurf — absent today
$ws = "C:\Users\KHS\.codeium\windsurf\mcp_config.json"
if (Test-Path $ws) { Copy-Item $ws "$ws.$ts.bak" }

# VS Code (user profile) — absent today
$vs = "C:\Users\KHS\AppData\Roaming\Code\User\mcp.json"
if (Test-Path $vs) { Copy-Item $vs "$vs.$ts.bak" }

# Claude Code config is managed by the `claude` CLI (no direct file to back up here).
# Snapshot current MCP servers for reference:
claude mcp list
```

Config file locations + schema written (from `mcp-clients.ts`):

| Client | Path (Windows) | Root key | Entry written |
|--------|----------------|----------|---------------|
| Claude Code | managed by `claude` CLI | n/a | `claude mcp add -s user stellavault -- <cmd>` |
| Claude Desktop | `…\AppData\Roaming\Claude\claude_desktop_config.json` | `mcpServers` | `{command:"cmd", args:["/c","stellavault","serve"]}` |
| Cursor | `…\.cursor\mcp.json` | `mcpServers` | `{command:"cmd", args:["/c","stellavault","serve"]}` |
| Windsurf | `…\.codeium\windsurf\mcp_config.json` | `mcpServers` | `{command:"cmd", args:["/c","stellavault","serve"]}` |
| VS Code | `…\AppData\Roaming\Code\User\mcp.json` | **`servers`** | `{type:"stdio", command:"cmd", args:["/c","stellavault","serve"]}` |

> VS Code is the schema outlier: root key is `servers` (not `mcpServers`) and each entry
> requires `"type": "stdio"`. The setup command already handles this difference.

### 3.2 Run setup

`stellavault setup` (no flags) only touches **detected** clients — on this machine that means
Claude Desktop (detect dir exists) + an attempt at Claude Code via the `claude` CLI. Cursor /
Windsurf / VS Code are **not** detected, so use `--all` (or `--client`) to write them too.

```powershell
# Verify the CLI is reachable first (PATH); errors otherwise only surface later when a client runs it.
stellavault --version

# Write to ALL five clients (recommended here, since 3 are undetected):
stellavault setup --all

#   alternatives:
#   stellavault setup                                   # detected clients only (Claude Desktop + Claude Code)
#   stellavault setup --client claude-desktop --client vscode   # target specific clients
```

If `stellavault` is not on PATH: `npm install -g stellavault` (after 0.8.0 publishes) or run
via `npx stellavault setup --all`.

### 3.3 Idempotency notes

- **File clients (Claude Desktop / Cursor / Windsurf / VS Code):** setup reads the existing
  JSON (or `{}`), sets only `json.mcpServers.stellavault` (VS Code: `json.servers.stellavault`),
  and writes back with `JSON.stringify(…, null, 2)`. All other servers and root keys are
  preserved. Re-running is safe and produces the same result.
- **Claude Code:** idempotent via `claude mcp remove stellavault` then `claude mcp add …`. If
  `claude --version` fails, that client is **skipped** and a manual command is printed. If
  `claude mcp remove` errors, the add does not proceed.
- **No backup is created by setup** and a malformed pre-existing JSON file will cause that
  client's write to fail (status `error`) — which is exactly why 3.1 backs up first. There is a
  small interrupt window (after read, before write); the backup covers it.

### 3.4 Per-client verification

```powershell
# Claude Code
claude mcp list
#   expect: stellavault → command "cmd", args "/c, stellavault, serve"

# Claude Desktop  — mcpServers.stellavault present, other servers intact
Get-Content "C:\Users\KHS\AppData\Roaming\Claude\claude_desktop_config.json" | ConvertFrom-Json | Select-Object -ExpandProperty mcpServers

# Cursor
Get-Content "C:\Users\KHS\.cursor\mcp.json" | ConvertFrom-Json | Select-Object -ExpandProperty mcpServers

# Windsurf
Get-Content "C:\Users\KHS\.codeium\windsurf\mcp_config.json" | ConvertFrom-Json | Select-Object -ExpandProperty mcpServers

# VS Code  — note: root key is `servers`, entry has type:"stdio"
Get-Content "C:\Users\KHS\AppData\Roaming\Code\User\mcp.json" | ConvertFrom-Json | Select-Object -ExpandProperty servers
```

Then:

1. **Restart** each app (Claude Desktop, Cursor, Windsurf, VS Code) — MCP servers load on
   startup. Claude Code picks up user-scope changes on next launch.
2. **Live MCP test:** in any client, ask something that triggers vault search (e.g. "search my
   notes for X" / "what notes do I have on X"). A response sourced from the vault confirms the
   `stellavault` MCP server is connected and serving the reindexed DB from Section 2.
3. Check the client's MCP status/logs for `stellavault` = connected (no JSON parse errors — note
   that malformed JSON fails **silently** in Claude clients).

### 3.5 Rollback

```powershell
# restore any client config from its stamped backup (use your $ts from 3.1)
Copy-Item "C:\Users\KHS\AppData\Roaming\Claude\claude_desktop_config.json.$ts.bak" "C:\Users\KHS\AppData\Roaming\Claude\claude_desktop_config.json" -Force
# (repeat for cursor / windsurf / vscode if those existed and were backed up)

# Claude Code: remove the entry the CLI added
claude mcp remove stellavault
```

---

## Appendix — verification log (facts this runbook is built on)

- Versions read live: root/core/cli/graph = `0.7.4`; sync = `1.0.0` (private). Tag `v0.7.4`.
- Unreleased commits: `8a5ff6f` (4-stage), `94e718c`+`fb29248` (gap-cache fixes), `d5931de`
  (gitignore), `bcebfa1` (A: setup+SKILL.md, B: entity-linking + adaptive rerank + B3 MCP wiring
  + `+21` smoke).
- Bundle version injection: `scripts/bundle-cli.mjs` reads root `package.json` → defines
  `__SV_VERSION__`. `scripts/prepack.mjs` strips `workspaces`/`devDependencies`/`scripts`;
  `postpack.mjs` restores. Root `files` allow-list = `dist/stellavault.js`, `dist/graph-ui/**`,
  `README.md`, `SKILL.md`, `LICENSE`, `SECURITY.md`.
- Live vault config (`~/.stellavault.json`): `vaultPath = F:/Obsidian/Evan`,
  `dbPath = F:\Obsidian\Evan\.stellavault.db`. DB-path precedence in
  `packages/cli/src/commands/index-cmd.ts::resolveDbPath` = env → config.dbPath → vault-hash.
- Live DB: `F:\Obsidian\Evan\.stellavault.db` ~176 MB, modified 2026-06-05, WAL active. Stale
  hash DBs under `~/.stellavault/vaults/`: `3d896717.db` (E:/obsidian/Evan), `6438b442.db`
  (F:/Obsidian/Evan) — NOT the active write target.
- Client configs present: Claude Desktop only. Cursor / Windsurf / VS Code absent (created fresh
  by setup). Setup schema/paths from `packages/cli/src/mcp-clients.ts`; flags from
  `packages/cli/src/index.ts` (no `--dry-run`; `-c/--client` repeatable, `--all`, `--command`,
  `--args`).
