// Stellavault Desktop — Main Process
// Owns: native modules (SQLite, embedder), file system, IPC handlers, window management.

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, resolve, sep } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import type { FileTreeNode, SearchResult, VaultStats, DecayItem } from '../shared/ipc-types.js';

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

  // Graph
  ipcMain.handle('graph:build', async (_e, mode: string) => {
    if (!coreReady || !store) return { nodes: [], edges: [] };
    try {
      const core = await import('@stellavault/core');
      const data = await core.buildGraphData(store, { mode: mode as 'semantic' | 'folder' });
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
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    frame: false, // Frameless for custom title bar
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Needed for native module preload
    },
    show: false,
  });

  // Show when ready to avoid blank flash
  win.once('ready-to-show', () => win.show());

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

// ─── App lifecycle ───────────────────────────────────

app.whenReady().then(async () => {
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
