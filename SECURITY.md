# Security Policy

## Data Access

Stellavault is **local-first**. Your knowledge stays on your machine.

### What Stellavault reads
- `.md`, `.txt`, `.pdf`, `.docx`, `.pptx`, `.xlsx` files **inside your configured vault path only**
- Files are read to build a search index (SQLite-vec database stored in `~/.stellavault/`)
- **Vault original files are never modified by the indexer** — Stellavault creates its own files in `raw/`, `_wiki/`, `_drafts/` folders

### When network requests occur
- **YouTube ingest**: fetches video metadata + captions from youtube.com (via yt-dlp)
- **URL ingest**: fetches the target URL to extract text
- **`stellavault draft --ai`**: sends vault excerpts to Anthropic API (requires explicit `ANTHROPIC_API_KEY` env var — opt-in only)
- **MCP serve**: local stdio/HTTP only — no external connections
- **Embedding model**: downloaded once from Hugging Face on first `stellavault index`, then cached locally

### What never leaves your machine
- Your vault files
- Your search index database
- Your session logs and daily logs
- Your draft outputs
- All MCP tool responses

## Vault Safety

- **Read-only default**: The search indexer reads files but does not modify them
- **New files only**: `ingest`, `session-save`, `compile`, `draft` create new `.md` files — they never overwrite existing vault notes
- **Edit is explicit**: The web UI edit feature and `PUT /api/document` require deliberate user action
- **Path traversal protection**: All file operations validate paths stay within vault root
- **Configurable folders**: `raw/`, `_wiki/`, `_literature/` names can be changed in `.stellavault.json`

## Input Sanitization

- **DOMPurify**: All markdown rendered in the web UI is sanitized against XSS
- **YAML sanitization**: Frontmatter values are escaped to prevent injection
- **File size limit**: 50MB max for binary file extraction
- **URL validation**: Image URLs restricted to `https://` scheme
- **SSRF protection**: Private/local IP addresses blocked for URL ingest

## Reporting Vulnerabilities

Please report security issues to: https://github.com/Evanciel/stellavault/issues (label: security)

Or email: [create a security@stellavault.dev when domain is registered]

## License

MIT — full source code is available for audit at https://github.com/Evanciel/stellavault
