// Stellavault Desktop — Main Process
// Owns: native modules (SQLite, embedder), file system, IPC handlers, window management.

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, resolve, sep } from 'node:path';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import type { AppSettings, FileTreeNode, SearchResult, VaultStats, DecayItem } from '../shared/ipc-types.js';
import { SettingsStore } from './settings-store.js';

// ─── Config ──────────────────────────────────────────

interface AppConfig {
  vaultPath: string;
  dbPath: string;
}

function loadAppConfig(): AppConfig {
  const paths = [
    join(process.cwd(), '.stellavault.json'),
    join(homedir(), '.stellavault.json'),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      const cfg = JSON.parse(readFileSync(p, 'utf-8'));
      return { vaultPath: cfg.vaultPath || '', dbPath: cfg.dbPath || '' };
    }
  }
  return { vaultPath: '', dbPath: '' };
}

// ─── Settings (W1-1) ─────────────────────────────────
// Desktop UI settings live in ~/.stellavault/desktop-settings.json — separate
// lifecycle from the vault bootstrap config above (§4-B). Created in whenReady.

let settingsStore: SettingsStore | null = null;

function broadcastSettingsChanged(settings: AppSettings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('settings:changed', settings);
  }
}

// ─── Core engine (lazy loaded to avoid blocking startup) ───

let coreReady = false;
let store: any = null;
let searchEngine: any = null;
let embedder: any = null;
let decayEngine: any = null;

async function initCore(config: AppConfig): Promise<void> {
  if (coreReady) return;
  try {
    const core = await import('@stellavault/core');
    const hub = core.createKnowledgeHub({
      vaultPath: config.vaultPath,
      dbPath: config.dbPath,
      folders: core.DEFAULT_FOLDERS,
      embedding: { model: 'local', localModel: 'all-MiniLM-L6-v2' },
      chunking: { maxTokens: 300, overlap: 50, minTokens: 50 },
      search: { defaultLimit: 10, rrfK: 60 },
      mcp: { mode: 'stdio', port: 3333 },
    });
    await hub.store.initialize();
    await hub.embedder.initialize();
    store = hub.store;
    searchEngine = hub.searchEngine;
    embedder = hub.embedder;

    // Initialize decay engine if DB is accessible
    try {
      const dbInstance = store.getDb();
      if (dbInstance) {
        decayEngine = new core.DecayEngine(dbInstance);
        await decayEngine.initializeNewDocuments();
      }
    } catch (err) {
      console.error('[main] DecayEngine init skipped:', err);
    }

    coreReady = true;
  } catch (err) {
    console.error('[main] Core init failed:', err);
  }
}

// ─── File tree builder ───────────────────────────────

function buildFileTree(dirPath: string, depth = 0): FileTreeNode[] {
  if (depth > 10) return []; // Safety limit
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const nodes: FileTreeNode[] = [];
    for (const entry of entries) {
      // Skip hidden dirs and known non-content dirs
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;

      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: fullPath,
          isDir: true,
          children: buildFileTree(fullPath, depth + 1),
        });
      } else if (entry.name.endsWith('.md')) {
        nodes.push({ name: entry.name, path: fullPath, isDir: false });
      }
    }
    // Sort: folders first, then alphabetical
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  } catch {
    return [];
  }
}

function collectAllNotes(dirPath: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) {
          // Return title (filename without extension)
          results.push(entry.name.replace(/\.md$/, ''));
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  walk(dirPath);
  return results;
}

// ─── Path safety ─────────────────────────────────────
// CRIT-01: Every IPC handler that touches the filesystem MUST validate
// that the resolved path is inside the vault root. Without this, a
// compromised renderer can read/write/delete ANY file on disk.

function assertInsideVault(vaultPath: string, filePath: string): string {
  const resolved = resolve(filePath);
  const vaultRoot = resolve(vaultPath);
  if (resolved !== vaultRoot && !resolved.startsWith(vaultRoot + sep)) {
    throw new Error(`Access denied: path outside vault — ${resolved}`);
  }
  return resolved;
}

// ─── IPC Handlers ────────────────────────────────────

function registerIpcHandlers(config: AppConfig) {
  const vp = config.vaultPath;

  // Vault FS — all paths validated against vault root
  ipcMain.handle('vault:get-path', () => vp);
  ipcMain.handle('vault:read-file', (_e, filePath: string) => {
    const safe = assertInsideVault(vp, filePath);
    return readFileSync(safe, 'utf-8');
  });
  ipcMain.handle('vault:write-file', (_e, filePath: string, content: string) => {
    const safe = assertInsideVault(vp, filePath);
    mkdirSync(join(safe, '..'), { recursive: true });
    writeFileSync(safe, content, 'utf-8');
  });
  ipcMain.handle('vault:rename', (_e, oldPath: string, newPath: string) => {
    const safeOld = assertInsideVault(vp, oldPath);
    const safeNew = assertInsideVault(vp, newPath);
    renameSync(safeOld, safeNew);
  });
  ipcMain.handle('vault:delete', (_e, filePath: string) => {
    const safe = assertInsideVault(vp, filePath);
    if (statSync(safe).isDirectory()) {
      rmSync(safe, { recursive: true });
    } else {
      unlinkSync(safe);
    }
  });
  ipcMain.handle('vault:read-tree', () => buildFileTree(vp));
  ipcMain.handle('vault:create-file', (_e, filePath: string, content?: string) => {
    const safe = assertInsideVault(vp, filePath);
    mkdirSync(join(safe, '..'), { recursive: true });
    writeFileSync(safe, content ?? '', 'utf-8');
  });
  ipcMain.handle('vault:create-folder', (_e, folderPath: string) => {
    const safe = assertInsideVault(vp, folderPath);
    mkdirSync(safe, { recursive: true });
  });
  ipcMain.handle('vault:list-notes', () => collectAllNotes(vp));

  // Core
  ipcMain.handle('core:search', async (_e, query: string, limit?: number) => {
    if (!coreReady || !searchEngine) return [];
    const results = await searchEngine.search({ query, limit: limit ?? 10 });
    return results.map((r: any) => ({
      id: r.document?.id ?? '',
      filePath: r.document?.filePath ?? '',
      title: r.document?.title ?? 'Untitled',
      score: r.score ?? 0,
      snippet: r.highlights?.[0] ?? '',
      tags: r.document?.tags ?? [],
    }));
  });

  ipcMain.handle('core:get-stats', async () => {
    if (!coreReady || !store) return { documentCount: 0, chunkCount: 0, dbSizeBytes: 0, lastIndexed: '' };
    return store.getStats();
  });

  ipcMain.handle('core:index', async () => {
    if (!coreReady) return { indexed: 0, totalChunks: 0 };
    const core = await import('@stellavault/core');
    const result = await core.indexVault(vp, { store, embedder, chunkOptions: { maxTokens: 300, overlap: 50, minTokens: 50 } });
    return { indexed: result.indexed, totalChunks: result.totalChunks };
  });

  ipcMain.handle('core:decay-top', async (_e, limit?: number) => {
    if (!coreReady || !decayEngine) return [];
    try {
      const items = await decayEngine.getDecaying(0.9, limit ?? 5);
      return items.map((d: any) => {
        // Resolve filePath from documents table
        const db = store.getDb();
        const doc = db?.prepare('SELECT file_path, title FROM documents WHERE id = ?').get(d.documentId) as any;
        return {
          documentId: d.documentId,
          title: d.title || doc?.title || 'Untitled',
          retrievability: Math.round(d.retrievability * 100) / 100,
          lastAccess: d.lastAccess,
          filePath: doc?.file_path ? join(vp, doc.file_path) : '',
        };
      }).filter((d: any) => d.filePath);
    } catch (err) {
      console.error('[main] core:decay-top failed:', err);
      return [];
    }
  });

  // Draft — generate a draft from vault knowledge
  ipcMain.handle('core:draft', async (_e, topic: string, format?: string) => {
    if (!coreReady || !searchEngine) return { title: '', content: '', sources: [] };
    try {
      const results = await searchEngine.search({ query: topic, limit: 5 });
      const sources = results.map((r: any) => r.document?.title ?? 'Untitled');
      const snippets = results.map((r: any) => r.highlights?.[0] ?? r.document?.content?.slice(0, 300) ?? '').filter(Boolean);

      const fmt = format ?? 'outline';
      let content = `# ${topic}\n\n`;
      if (fmt === 'outline') {
        content += `## Key Points\n\n`;
        snippets.forEach((s: string, i: number) => {
          content += `${i + 1}. ${s.trim().slice(0, 200)}\n\n`;
        });
        content += `## Sources\n\n`;
        sources.forEach((s: string) => { content += `- [[${s}]]\n`; });
      } else if (fmt === 'blog') {
        content += `> Draft generated from ${sources.length} vault sources.\n\n`;
        snippets.forEach((s: string) => { content += `${s.trim()}\n\n`; });
        content += `---\n\n## References\n\n`;
        sources.forEach((s: string) => { content += `- [[${s}]]\n`; });
      }
      return { title: topic, content, sources };
    } catch {
      return { title: topic, content: `# ${topic}\n\nNo relevant notes found.`, sources: [] };
    }
  });

  // Graph — [W1-8 owned block]
  // Plan SC: §0-B2 — buildGraphData is now exported from @stellavault/core.
  // Contract (§4-F): core nodes are { id, label, filePath, tags, clusterId, size } and
  // NEVER carry positions — GraphPanel derives deterministic hash(id)-seeded layout.
  ipcMain.handle('graph:build', async (_e, mode: string) => {
    if (!coreReady || !store) return { nodes: [], edges: [] };
    try {
      const core = await import('@stellavault/core');
      const safeMode: 'semantic' | 'folder' = mode === 'folder' ? 'folder' : 'semantic';
      const data = await core.buildGraphData(store, { mode: safeMode });
      return data;
    } catch (err) {
      console.error('[main] Graph build failed:', err);
      return { nodes: [], edges: [] };
    }
  });

  // Backlinks — find notes that contain [[title]]
  ipcMain.handle('backlinks:find', (_e, title: string) => {
    const results: Array<{ filePath: string; name: string; line: string }> = [];
    const pattern = `[[${title}]]`;
    function walk(dir: string) {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!entry.name.endsWith('.md')) continue;
          try {
            const content = readFileSync(full, 'utf-8');
            if (content.includes(pattern)) {
              const lineMatch = content.split('\n').find((l) => l.includes(pattern));
              results.push({
                filePath: full,
                name: entry.name.replace(/\.md$/, ''),
                line: (lineMatch ?? '').trim().slice(0, 120),
              });
            }
          } catch { /* skip unreadable */ }
        }
      } catch { /* skip */ }
    }
    walk(vp);
    return results;
  });

  // Settings (W1-1) — get/set + broadcast to all windows on change
  ipcMain.handle('settings:get', () => {
    if (!settingsStore) settingsStore = new SettingsStore();
    return settingsStore.get();
  });
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    if (!settingsStore) settingsStore = new SettingsStore();
    const merged = settingsStore.set(patch ?? {});
    broadcastSettingsChanged(merged);
    return merged;
  });

  // Window controls
  ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.handle('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
  });
  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
}

// ─── Window ──────────────────────────────────────────

function createWindow() {
  // Restore persisted bounds (W1-1) — fall back to defaults if absent.
  if (!settingsStore) settingsStore = new SettingsStore();
  const bounds = settingsStore.get().window;

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 800,
    minHeight: 500,
    frame: false, // Frameless for custom title bar
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      // preload.js sits next to the main bundle in .vite/build (renamed from the
      // default index.js to avoid colliding with the main bundle's filename).
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // HIGH-04: sandbox enabled. Preload only uses contextBridge +
      // ipcRenderer (no native modules), so full sandbox is safe.
      // All native module work (SQLite, embedder) runs in main process.
      sandbox: true,
    },
    show: false,
  });

  // Show when ready to avoid blank flash
  win.once('ready-to-show', () => win.show());

  // Persist window bounds — debounced on resize/move, final flush on close.
  let boundsTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (win.isDestroyed() || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
    const { width, height, x, y } = win.getBounds();
    settingsStore?.set({ window: { width, height, x, y } });
  };
  const saveBoundsDebounced = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 500);
  };
  win.on('resize', saveBoundsDebounced);
  win.on('move', saveBoundsDebounced);
  win.on('close', () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    saveBounds();
  });

  // Load the Vite dev server or built renderer
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  return win;
}

// Vite dev server URL (injected by electron-forge)
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// ─── Smoke test (CI / local launch verification) ─────
// `stellavault --smoke-core` loads @stellavault/core, opens the SQLite DB and runs a
// query under Electron's runtime, writes the outcome to STELLAVAULT_SMOKE_OUT, then exits
// (0 = ok, 1 = fail). This converts the historically SILENT core-init failure (native
// module missing / wrong ABI) into an observable pass/fail for CI + local verification.
async function runSmokeCore(): Promise<void> {
  const outFile = process.env.STELLAVAULT_SMOKE_OUT || join(homedir(), 'sv-smoke-result.txt');
  const vaultPath = process.env.STELLAVAULT_SMOKE_VAULT || homedir();
  const dbPath = process.env.STELLAVAULT_SMOKE_DB || join(homedir(), 'sv-smoke.db');
  // Step trace — if any step hangs (vs throws), the .progress file shows where.
  const progress = (step: string): void => {
    try { appendFileSync(`${outFile}.progress`, `${new Date().toISOString()} ${step}\n`, 'utf-8'); } catch { /* best-effort */ }
  };
  try {
    progress('start');
    const core = await import('@stellavault/core');
    progress('core-imported');
    const hub = core.createKnowledgeHub({
      vaultPath,
      dbPath,
      folders: core.DEFAULT_FOLDERS,
      embedding: { model: 'local', localModel: 'all-MiniLM-L6-v2' },
      chunking: { maxTokens: 300, overlap: 50, minTokens: 50 },
      search: { defaultLimit: 10, rrfK: 60 },
      mcp: { mode: 'stdio', port: 3333 },
    });
    progress('hub-created');
    await hub.store.initialize();
    progress('store-initialized');
    // getDb() is typed `unknown` in core (store/types.ts) — cast for the raw smoke query.
    (hub.store.getDb() as { prepare(sql: string): { get(): unknown } } | undefined)?.prepare('SELECT 1 AS ok').get();
    progress('query-ok');
    writeFileSync(outFile, `SMOKE_OK better-sqlite3 + sqlite-vec + @stellavault/core loaded under Electron (db=${dbPath})\n`, 'utf-8');
    app.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? (err.stack || err.message) : String(err);
    writeFileSync(outFile, `SMOKE_FAIL ${msg}\n`, 'utf-8');
    app.exit(1);
  }
}

// ─── App lifecycle ───────────────────────────────────

app.whenReady().then(async () => {
  // CI / local launch verification — prove core + native modules load in the
  // PACKAGED app, then exit. Must run before any window/dialog work.
  if (process.argv.includes('--smoke-core')) {
    await runSmokeCore();
    return;
  }

  const config = loadAppConfig();

  if (!config.vaultPath) {
    // No vault configured — let user pick one
    const result = await dialog.showOpenDialog({
      title: 'Select your vault folder',
      message: 'Choose the folder containing your .md notes',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      app.quit();
      return;
    }
    config.vaultPath = result.filePaths[0];
    config.dbPath = join(homedir(), '.stellavault', 'index.db');
    mkdirSync(join(homedir(), '.stellavault'), { recursive: true });
    writeFileSync(
      join(homedir(), '.stellavault.json'),
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  }

  registerIpcHandlers(config);

  const win = createWindow();

  // Init core in background — don't block window creation
  void initCore(config).then(() => {
    win.webContents.send('core:ready');
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
