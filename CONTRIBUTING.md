# Contributing to Evan Knowledge Hub

Thank you for your interest in contributing!

## Development Setup

```bash
# Clone the repository
git clone https://github.com/your-username/evan-knowledge-hub.git
cd evan-knowledge-hub

# Install dependencies
npm install

# Run tests
npm test

# Start the graph visualization (requires indexed vault)
npm run dev:core
```

## Project Structure

```
packages/
  core/     Core engine (indexer, search, MCP server, API)
  cli/      CLI commands (stellavault index/search/serve/graph/...)
  graph/    3D Knowledge Graph (React Three Fiber)
  desktop/  Electron desktop app (independent 0.1.x release)
  sync/     Notion-Obsidian sync
```

## Code Conventions

- **Language**: TypeScript strict mode, ESM modules
- **File naming**: kebab-case.ts
- **Components**: PascalCase.tsx, functional + hooks
- **Testing**: Vitest
- **Import order**: node: builtins > external > internal

## Pull Request Process

1. Fork the repo and create your branch from `main`
2. Write tests for new functionality
3. Ensure all 92+ tests pass (`npm test`)
4. Keep PRs focused on a single change
5. Add Design Ref comments for architectural decisions:
   ```typescript
   // Design Ref: SS{section} - {rationale}
   ```

## Architecture

The project follows **Option C (Pragmatic Split)**:
- `core/` = engine + MCP (Clean Architecture layers)
- `cli/` = user-facing commands
- `graph/` = React Three Fiber visualization

Key patterns:
- Dependency Injection via `createKnowledgeHub()` factory
- Zustand for graph state management
- BM25 + Cosine + RRF hybrid search

## Releasing the desktop app

The Electron desktop app (`packages/desktop`) is **versioned independently** from
the npm package / core (it lives on its own `0.1.x` track) and is shipped as a
**separate GitHub Release**, built by the [`Desktop Release`](.github/workflows/desktop-release.yml) workflow.

Because the app loads native modules (`better-sqlite3`, `sqlite-vec`) at runtime,
each platform **must be built on its own OS** so the addons compile against
Electron's ABI. The workflow does this with a `windows-latest` + `ubuntu-latest`
matrix and uploads the per-platform ZIPs to the release.

The **git tag is the single source of truth** for the version — CI stamps
`desktop-vX.Y.Z` into the build, so the Windows and Linux artifacts always share
one version and bundle the *current* `@stellavault/core` at that commit.

**Cut a release** (builds both platforms + publishes):

```bash
git tag desktop-v0.1.1
git push origin desktop-v0.1.1
```

**Verify a build without publishing** (recommended before a real release):
GitHub → **Actions → Desktop Release → Run workflow** → set the tag, leave
`publish` unchecked. This builds both platforms and uploads them as workflow
artifacts (no public release is created).

> Note: native packaging across a monorepo can be environment-sensitive. The
> first CI run is the real verification — if a packaged app fails to launch,
> check that the native modules were rebuilt/unpacked (consider
> `@electron-forge/plugin-auto-unpack-natives`).

## License

MIT
