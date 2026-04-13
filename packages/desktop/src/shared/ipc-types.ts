// Typed IPC channel definitions shared between main and preload.
// Every channel has a name, argument tuple, and return type.

export interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
}

export interface SearchResult {
  id: string;
  filePath: string;
  title: string;
  score: number;
  snippet: string;
  tags: string[];
}

export interface VaultStats {
  documentCount: number;
  chunkCount: number;
  dbSizeBytes: number;
  lastIndexed: string;
}

// ─── Channel map: channel name → { args, result } ───

export interface IpcChannelMap {
  // Vault filesystem
  'vault:read-file':     { args: [filePath: string]; result: string };
  'vault:write-file':    { args: [filePath: string, content: string]; result: void };
  'vault:rename':        { args: [oldPath: string, newPath: string]; result: void };
  'vault:delete':        { args: [filePath: string]; result: void };
  'vault:read-tree':     { args: []; result: FileTreeNode[] };
  'vault:create-file':   { args: [filePath: string, content?: string]; result: void };
  'vault:create-folder': { args: [folderPath: string]; result: void };
  'vault:list-notes':    { args: []; result: string[] };
  'vault:get-path':      { args: []; result: string };

  // Core
  'core:search':        { args: [query: string, limit?: number]; result: SearchResult[] };
  'core:get-stats':     { args: []; result: VaultStats };
  'core:index':         { args: []; result: { indexed: number; totalChunks: number } };

  // Settings
  'settings:get':       { args: []; result: Record<string, unknown> };
  'settings:set':       { args: [key: string, value: unknown]; result: void };

  // Window
  'window:minimize':    { args: []; result: void };
  'window:maximize':    { args: []; result: void };
  'window:close':       { args: []; result: void };
}

// ─── Events (main → renderer, one-way) ───

export interface IpcEventMap {
  'file:changed':     { filePath: string; event: 'add' | 'change' | 'unlink' };
  'index:progress':   { current: number; total: number; title: string };
}

// Helper types for typed invoke/on
export type IpcChannel = keyof IpcChannelMap;
export type IpcArgs<C extends IpcChannel> = IpcChannelMap[C]['args'];
export type IpcResult<C extends IpcChannel> = IpcChannelMap[C]['result'];
