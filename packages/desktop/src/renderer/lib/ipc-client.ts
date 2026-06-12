// Typed IPC client for the renderer process.
// Usage: const content = await ipc('vault:read-file', '/path/to/note.md');

import type { IpcChannel, IpcArgs, IpcResult, AppSettings, SearchResult } from '../../shared/ipc-types.js';
import type { StellavaultApi } from '../../preload/index.js';

declare global {
  interface Window {
    stellavault: StellavaultApi;
  }
}

export function ipc<C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcResult<C>> {
  return window.stellavault.invoke(channel, ...args);
}

export function onIpc(channel: string, callback: (...args: unknown[]) => void): () => void {
  return window.stellavault.on(channel, callback);
}

// ─── Settings (W1-1) — typed convenience wrappers ───

export function settingsGet(): Promise<AppSettings> {
  return ipc('settings:get');
}

export function settingsSet(patch: Partial<AppSettings>): Promise<AppSettings> {
  return ipc('settings:set', patch);
}

/** Subscribe to main-process settings broadcasts. Returns unsubscribe. */
export function onSettingsChanged(callback: (settings: AppSettings) => void): () => void {
  return onIpc('settings:changed', (settings) => callback(settings as AppSettings));
}

// ─── Stage C (W1-4/W1-6) — search & tags wrappers ───
// NOTE: 'search:query' / 'tags:list' are declared in shared/ipc-types.ts and
// the preload allowlist by the Stage C main-process work. The signatures below
// mirror that contract EXACTLY; we invoke via a cast so this file compiles
// independently of merge order. Once the channel map lands, these can be
// switched to the typed `ipc()` helper with no call-site changes.

export interface SearchQueryOpts {
  mode?: 'hybrid' | 'keyword';
  tags?: string[];
  pathPrefix?: string;
  limit?: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

function rawInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return (window.stellavault.invoke as unknown as (c: string, ...a: unknown[]) => Promise<unknown>)(
    channel,
    ...args,
  );
}

/** Contract: 'search:query' (query, opts?) → SearchResult[] */
export function searchQuery(query: string, opts?: SearchQueryOpts): Promise<SearchResult[]> {
  return rawInvoke('search:query', query, opts) as Promise<SearchResult[]>;
}

/** Contract: 'tags:list' () → { tag, count }[] */
export function tagsList(): Promise<TagCount[]> {
  return rawInvoke('tags:list') as Promise<TagCount[]>;
}

// ─── Stage D (W1-3/W1-9/W1-10) — file operation wrappers ───
// These channels are in the shared map + preload allowlist (same stage),
// so they go through the fully typed ipc() helper.

/** Move a file or folder to the OS trash (recoverable — §4-G). */
export function vaultTrash(filePath: string): Promise<void> {
  return ipc('vault:trash', filePath);
}

/** Duplicate a file/folder as "name (copy)". Returns the ABSOLUTE new path. */
export function vaultDuplicate(filePath: string): Promise<string> {
  return ipc('vault:duplicate', filePath);
}

export function vaultExists(path: string): Promise<boolean> {
  return ipc('vault:exists', path);
}

/** Recursive listing under a vault folder — ABSOLUTE paths, optional ext filter ('md' or '.md'). */
export function vaultListFiles(dirPath: string, ext?: string): Promise<string[]> {
  return ipc('vault:list-files', dirPath, ext);
}

/** Rewrite [[oldTitle]] / [[oldTitle|…]] / [[oldTitle#…]] vault-wide (code-fence aware). Returns changed file count. */
export function vaultUpdateLinks(oldTitle: string, newTitle: string): Promise<number> {
  return ipc('vault:update-links', oldTitle, newTitle);
}
