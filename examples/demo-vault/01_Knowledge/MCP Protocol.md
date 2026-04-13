---
title: "MCP Protocol"
tags: [mcp, claude, ai, protocol]
type: wiki
created: 2026-04-13
---

# Model Context Protocol (MCP)

MCP is an open standard for connecting AI models to external data sources. It enables Claude to read your knowledge base, search documents, and take actions through defined tools.

## Architecture

```
Claude ←→ MCP Client ←→ MCP Server ←→ Your Data
          (stdio/SSE)    (tools)      (files, DB)
```

## Tool Types

- **Read tools**: search, get-document, list-topics
- **Write tools**: create-knowledge-node, log-decision
- **Compute tools**: detect-gaps, get-decay-status, get-evolution

## Best Practices

1. Keep tools focused — one responsibility per tool
2. Return structured JSON, let Claude format for the user
3. Validate all inputs at the tool boundary
4. Rate-limit write operations to prevent abuse

## Related

- [[Knowledge Graphs]] — MCP tools expose graph data to AI
- [[Vector Databases]] — MCP search uses vector similarity
