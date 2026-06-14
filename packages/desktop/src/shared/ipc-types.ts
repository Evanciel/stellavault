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

export interface DecayItem {
  documentId: string;
  title: string;
  retrievability: number;
  lastAccess: string;
  filePath: string;
}

// Search panel (W1-4) — options for 'search:query'.
// mode 'keyword' disables the semantic signal (BM25 + entity only);
// pathPrefix is a vault-relative folder prefix (forward slashes), filtered post-hoc.
export interface SearchQueryOpts {
  mode?: 'hybrid' | 'keyword';
  tags?: string[];
  pathPrefix?: string;
  limit?: number;
}

// Ask panel (W1-13) — result of 'core:ask'. answer === '' means degraded
// (citations-only) mode; the UI should render sources without a synthesis block.
export interface AskResponse {
  answer: string;
  citations: { filePath: string; title: string; snippet: string }[];
}

// App settings — persisted at ~/.stellavault/desktop-settings.json (W1-1).
// Defaults live in main/settings-store.ts (getDefaults) and mirror this shape.
export interface AppSettings {
  version: 1;
  theme: 'dark' | 'light' | 'system';
  accent: string;              // hex
  editor: { fontSize: number; lineWidth: number; spellcheck: boolean };
  hotkeys: Record<string, string>;   // commandId -> 'mod+shift+f' style
  dailyNotes: { folder: string; format: string; templatePath: string };
  templatesFolder: string;
  bookmarks: { type: 'note' | 'search'; target: string; label: string }[];
  session: { openTabs: string[]; activeTab: string | null };
  window: { width: number; height: number; x?: number; y?: number };
  // T1-9: persisted resizable pane widths (px). Optional so older settings
  // files / main getDefaults that predate this slice still type-check; the
  // renderer reads with a fallback. Security agent: add matching keys to
  // main/settings-store.ts getDefaults().
  panels?: { sidebarWidth: number; rightPanelWidth: number };
  // T1-15: persisted graph force-sim slider values. Optional, same rationale.
  // Shape mirrors SimSettings (renderer/components/graph/force-sim.ts).
  graph?: { repel: number; link: number; center: number; linkDistance: number };
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

  // File operations (W1-3 / W1-9 / W1-10 — Stage D)
  'vault:trash':         { args: [filePath: string]; result: void };          // shell.trashItem (§4-G)
  'vault:duplicate':     { args: [filePath: string]; result: string };        // returns ABSOLUTE new path
  'vault:exists':        { args: [path: string]; result: boolean };
  'vault:list-files':    { args: [dirPath: string, ext?: string]; result: string[] }; // ABSOLUTE paths, recursive
  'vault:update-links':  { args: [oldTitle: string, newTitle: string]; result: number }; // changed file count, code-fence aware

  // Core
  'core:search':        { args: [query: string, limit?: number]; result: SearchResult[] };
  'core:get-stats':     { args: []; result: VaultStats };
  'core:index':         { args: []; result: { indexed: number; totalChunks: number } };
  'core:decay-top':     { args: [limit?: number]; result: DecayItem[] };

  // Search panel (W1-4) — full hybrid/keyword search with tag + path filters.
  'search:query':       { args: [query: string, opts?: SearchQueryOpts]; result: SearchResult[] };

  // Tags panel (W1-6) — aggregate tag counts from the core index.
  'tags:list':          { args: []; result: { tag: string; count: number }[] };

  // Ask panel (W1-13) — askVault wiring. Empty answer + citations = degraded mode.
  'core:ask':           { args: [question: string]; result: AskResponse };

  // FSRS loop (W1-14) — record access + generalized decay list (decay-top kept).
  // T2-5: optional grade = FSRS recall judgement (1 Again / 2 Hard / 3 Good / 4 Easy)
  // from the Memory-tab review buttons. Omitted for plain opens (weak access).
  'core:record-access': { args: [filePath: string, kind: 'open' | 'review', grade?: 1 | 2 | 3 | 4]; result: void };
  'core:decay-list':    { args: [limit?: number]; result: DecayItem[] };

  // Related notes (W1-16)
  'core:related':       { args: [filePath: string, limit?: number]; result: SearchResult[] };

  // Draft (Express)
  'core:draft':         { args: [topic: string, format?: string]; result: { title: string; content: string; sources: string[] } };

  // Graph
  'graph:build':        { args: [mode: string]; result: { nodes: unknown[]; edges: unknown[] } };

  // Backlinks
  'backlinks:find':     { args: [title: string]; result: Array<{ filePath: string; name: string; line: string }> };

  // Window
  'window:minimize':    { args: []; result: void };
  'window:maximize':    { args: []; result: void };
  'window:close':       { args: []; result: void };
  // App menu (W2) — webContents zoom; returns the new zoom factor.
  'window:zoom':        { args: [action: 'in' | 'out' | 'reset']; result: number };

  // Shell (W2 — app menu). open-path is vault-root restricted; open-external is https-only.
  'shell:open-path':     { args: [path: string]; result: void };
  'shell:open-external': { args: [url: string]; result: void };

  // Settings (W1-1)
  'settings:get':       { args: []; result: AppSettings };
  'settings:set':       { args: [patch: Partial<AppSettings>]; result: AppSettings };

  // [editor-upgrade additive] Local image import — copies bytes (base64) or a
  // source file into <vault>/assets/, returns the VAULT-RELATIVE path.
  'vault:import-asset': { args: [payload: { base64?: string; srcPath?: string; fileName: string }]; result: string };
}

// ─── Events (main → renderer, one-way) ───

export interface IpcEventMap {
  'file:changed':     { filePath: string; event: 'add' | 'change' | 'unlink' };
  'index:progress':   { current: number; total: number; title: string };
  'settings:changed': AppSettings;
}

// Helper types for typed invoke/on
export type IpcChannel = keyof IpcChannelMap;
export type IpcArgs<C extends IpcChannel> = IpcChannelMap[C]['args'];
export type IpcResult<C extends IpcChannel> = IpcChannelMap[C]['result'];
