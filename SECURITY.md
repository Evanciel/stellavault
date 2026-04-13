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

## Desktop App Security (Electron)

- **Context Isolation**: enabled — renderer cannot access Node.js APIs
- **Sandbox**: enabled — renderer runs with reduced OS privileges
- **Node Integration**: disabled — no `require()` in renderer
- **IPC Allowlist**: explicit channel whitelist in preload (17 channels)
- **Path Validation**: all vault filesystem IPC handlers validate paths stay inside vault root
- **Auth Token**: API server generates per-session random token for all mutating endpoints
- **CSP**: strict Content Security Policy (no unsafe-eval in production)

## Federation Security

- **Embeddings only**: original text never transmitted over the network
- **Buffer limits**: 1MB per connection, 64KB per message
- **Message validation**: schema checking on all incoming messages
- **Leave authentication**: leave messages only accepted from the owning connection
- **Differential privacy**: noise added to shared embeddings

## Known Accepted Risks

- **LOW-03**: `data:` URIs allowed in desktop CSP for inline images in markdown editor
- **LOW-05**: Cloud sync uses Bearer token instead of AWS Signature v4 (R2-specific)

## Reporting Vulnerabilities

Please report security issues to: https://github.com/Evanciel/stellavault/issues (label: security)

Or email: [create a security@stellavault.dev when domain is registered]

## License

MIT — full source code is available for audit at https://github.com/Evanciel/stellavault
