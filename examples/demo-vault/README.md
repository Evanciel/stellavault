# Stellavault Demo Vault

A sample knowledge vault to try Stellavault instantly.

## Quick Start

```bash
# 1. Index this vault
npx stellavault index --vault ./examples/demo-vault

# 2. Search your knowledge
npx stellavault search "vector database"

# 3. Launch the 3D graph
npx stellavault graph

# 4. Start MCP server (for Claude)
npx stellavault mcp
```

## What's Inside

| Folder | Notes | Topic |
|--------|-------|-------|
| `01_Knowledge/` | 5 wiki notes | CS fundamentals, architecture patterns |
| `02_Literature/` | 3 literature notes | Research papers, book summaries |
| `00_Fleeting/` | 2 quick captures | Ideas, observations |

## Use with Claude

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "stellavault": {
      "command": "npx",
      "args": ["-y", "stellavault", "mcp", "--vault", "./examples/demo-vault"]
    }
  }
}
```

Then ask Claude: "What do I know about vector databases?"
