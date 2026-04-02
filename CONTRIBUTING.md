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
  cli/      CLI commands (ekh index/search/serve/graph/card/pack)
  graph/    3D Knowledge Graph (React Three Fiber)
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

## License

MIT
