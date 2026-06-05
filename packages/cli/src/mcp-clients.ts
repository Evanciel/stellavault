// Upgrade A1 — one-command MCP client setup.
//
// Writes Stellavault's MCP server entry into each supported AI client's config,
// idempotently and OS-aware. Claude Code is handled via its official
// `claude mcp add` CLI (which abstracts an evolving config schema); the other
// four clients are plain JSON config-file merges (read → set → write).

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface ServeCommand {
  command: string;
  args: string[];
}

export interface FileClient {
  id: string;
  label: string;
  /** Config file path for the current OS. */
  configPath: string;
  /** Directory whose existence implies the client is installed. */
  detectDir: string;
  /** JSON key under which MCP servers are stored. */
  serversKey: 'mcpServers' | 'servers';
  /** VS Code requires each server entry to carry "type": "stdio". */
  needsType: boolean;
}

export type SetupStatus = 'written' | 'updated' | 'skipped' | 'error';

export interface SetupResult {
  client: string;
  status: SetupStatus;
  path?: string;
  detail?: string;
}

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function appData(): string {
  return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
}
function xdgConfig(): string {
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
}

/** Resolve how clients should invoke the MCP server.
 *  On Windows the global bin is `stellavault.cmd`; MCP clients spawn without a
 *  shell, so we route through cmd.exe which resolves the shim. */
export function resolveServeCommand(override?: { command?: string; args?: string }): ServeCommand {
  if (override?.command) {
    const args = override.args ? override.args.split(/\s+/).filter(Boolean) : ['serve'];
    return { command: override.command, args };
  }
  if (isWin) return { command: 'cmd', args: ['/c', 'stellavault', 'serve'] };
  return { command: 'stellavault', args: ['serve'] };
}

function claudeDesktopPath(): string {
  if (isWin) return join(appData(), 'Claude', 'claude_desktop_config.json');
  if (isMac) return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return join(xdgConfig(), 'Claude', 'claude_desktop_config.json');
}
function vscodePath(): string {
  if (isWin) return join(appData(), 'Code', 'User', 'mcp.json');
  if (isMac) return join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
  return join(xdgConfig(), 'Code', 'User', 'mcp.json');
}

export const FILE_CLIENTS: FileClient[] = [
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    configPath: claudeDesktopPath(),
    detectDir: dirname(claudeDesktopPath()),
    serversKey: 'mcpServers',
    needsType: false,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    configPath: join(homedir(), '.cursor', 'mcp.json'),
    detectDir: join(homedir(), '.cursor'),
    serversKey: 'mcpServers',
    needsType: false,
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    configPath: join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    detectDir: join(homedir(), '.codeium'),
    serversKey: 'mcpServers',
    needsType: false,
  },
  {
    id: 'vscode',
    label: 'VS Code',
    configPath: vscodePath(),
    detectDir: dirname(dirname(vscodePath())), // .../Code
    serversKey: 'servers',
    needsType: true,
  },
];

/** Every supported client id, including the CLI-based Claude Code. */
export const ALL_CLIENT_IDS = ['claude-code', ...FILE_CLIENTS.map(c => c.id)];

export function isDetected(client: FileClient): boolean {
  return existsSync(client.detectDir);
}

/** Merge the stellavault server entry into a client's JSON config (idempotent). */
export function writeClientConfig(client: FileClient, serve: ServeCommand): SetupResult {
  const path = client.configPath;
  try {
    let json: Record<string, any> = {};
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8').trim();
      if (raw) json = JSON.parse(raw);
    }
    const key = client.serversKey;
    if (typeof json[key] !== 'object' || json[key] === null) json[key] = {};
    const already = Boolean(json[key].stellavault);
    json[key].stellavault = client.needsType
      ? { type: 'stdio', command: serve.command, args: serve.args }
      : { command: serve.command, args: serve.args };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf-8');
    return { client: client.label, status: already ? 'updated' : 'written', path };
  } catch (err) {
    return { client: client.label, status: 'error', path, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Claude Code: use the official CLI (it abstracts the evolving config schema). */
export function setupClaudeCode(serve: ServeCommand): SetupResult {
  const manual = `claude mcp add -s user stellavault -- ${serve.command} ${serve.args.join(' ')}`;
  try {
    execSync('claude --version', { stdio: 'ignore' });
  } catch {
    return { client: 'Claude Code', status: 'skipped', detail: `claude CLI not found — run manually:\n           ${manual}` };
  }
  try {
    // Idempotent: drop any existing entry first (ignore failure), then add.
    try { execSync('claude mcp remove stellavault', { stdio: 'ignore' }); } catch { /* not present */ }
    execSync(manual, { stdio: 'ignore' });
    return { client: 'Claude Code', status: 'written', detail: 'via claude mcp add (user scope)' };
  } catch (err) {
    return { client: 'Claude Code', status: 'error', detail: `${err instanceof Error ? err.message : String(err)} — try: ${manual}` };
  }
}
