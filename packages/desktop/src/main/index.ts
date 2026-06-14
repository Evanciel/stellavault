// Stellavault Desktop — Main Process
// Owns: native modules (SQLite, embedder), file system, IPC handlers, window management.

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join, relative, resolve, dirname, basename, extname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync, rmSync, copyFileSync, cpSync, watch as fsWatch } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import type { AppSettings, FileTreeNode, SearchResult, SearchQueryOpts, AskResponse, VaultStats, DecayItem } from '../shared/ipc-types.js';
import { SettingsStore } from './settings-store.js';
import { assertInsideVault, sanitizeAssetName, assertAssetSize } from './path-safety.js';
import { validateSettingsPatch } from './settings-validate.js';

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
      // T1-13: a malformed ~/.stellavault.json must not block startup. On a parse
      // error, fall through (→ empty config → vault picker) instead of crashing.
      try {
        const cfg = JSON.parse(readFileSync(p, 'utf-8'));
        if (cfg && typeof cfg === 'object') {
          return {
            vaultPath: typeof cfg.vaultPath === 'string' ? cfg.vaultPath : '',
            dbPath: typeof cfg.dbPath === 'string' ? cfg.dbPath : '',
          };
        }
      } catch (err) {
        console.error(`[main] failed to parse ${p} — falling back to vault picker:`, err);
      }
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
// Chunk options resolved at initCore time — reused by core:index and the watcher reindex.
let coreChunkOptions: { maxTokens: number; overlap: number; minTokens: number } = { maxTokens: 300, overlap: 50, minTokens: 50 };

async function initCore(config: AppConfig): Promise<void> {
  if (coreReady) return;
  try {
    const core = await import('@stellavault/core');
    // W1-4 risk fix: don't hardcode core config — go through core.loadConfig()
    // (reads .stellavault.json with full defaults merge) so the user's
    // search.weights / entityAliases apply to desktop search too. Fall back to
    // the previous literal config if loadConfig is unavailable (older core).
    let hubConfig: any;
    try {
      hubConfig = typeof (core as any).loadConfig === 'function' ? (core as any).loadConfig() : null;
    } catch (err) {
      console.error('[main] core.loadConfig failed — using built-in defaults:', err);
      hubConfig = null;
    }
    if (!hubConfig) {
      hubConfig = {
        folders: core.DEFAULT_FOLDERS,
        // T1-10: multilingual MiniLM (384d, drop-in for the old English-only
        // all-MiniLM-L6-v2) — Korean-first vaults search far better. Existing
        // indexes built with the old model: a reindex is recommended.
        embedding: { model: 'local', localModel: 'paraphrase-multilingual-MiniLM-L12-v2' },
        chunking: { maxTokens: 300, overlap: 50, minTokens: 50 },
        search: { defaultLimit: 10, rrfK: 60 },
        mcp: { mode: 'stdio', port: 3333 },
      };
    }
    // The desktop bootstrap (vault picker dialog) is authoritative for paths.
    hubConfig = { ...hubConfig, vaultPath: config.vaultPath, dbPath: config.dbPath || hubConfig.dbPath };
    coreChunkOptions = { ...coreChunkOptions, ...hubConfig.chunking };
    const hub = core.createKnowledgeHub(hubConfig);
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
// CRIT-01: Every IPC handler that touches the filesystem MUST validate that the
// resolved path is inside the vault root. The implementation lives in the pure,
// unit-tested ./path-safety module (T1-3) — imported above as assertInsideVault.

// ─── Core result/path helpers ────────────────────────

/** Vault-relative path with forward slashes — matches core's documents.file_path. */
function toVaultRel(vaultPath: string, filePath: string): string {
  return relative(resolve(vaultPath), resolve(filePath)).replace(/\\/g, '/');
}

/** Map a core SearchResult (chunk+document) to the IPC SearchResult shape (absolute path). */
function mapCoreSearchResult(vaultPath: string, r: any): SearchResult {
  return {
    id: r.document?.id ?? '',
    filePath: r.document?.filePath ? join(vaultPath, r.document.filePath) : '',
    title: r.document?.title ?? 'Untitled',
    score: r.score ?? 0,
    snippet: r.highlights?.[0] ?? '',
    tags: r.document?.tags ?? [],
  };
}

/** Resolve a document id from an absolute file path — DB lookup first (authoritative),
 *  hash fallback mirrors core scanner: sha256(relPath).slice(0,16). */
function docIdForFile(vaultPath: string, filePath: string): string {
  const rel = toVaultRel(vaultPath, filePath);
  try {
    const db = store?.getDb?.();
    const row = db?.prepare('SELECT id FROM documents WHERE file_path = ?').get(rel) as { id: string } | undefined;
    if (row?.id) return row.id;
  } catch { /* fall through to hash */ }
  return createHash('sha256').update(rel).digest('hex').slice(0, 16);
}

/** Shared DecayItem mapping for core:decay-top / core:decay-list. */
async function getDecayItems(vaultPath: string, limit: number): Promise<DecayItem[]> {
  if (!coreReady || !decayEngine) return [];
  const items = await decayEngine.getDecaying(0.9, limit);
  return items.map((d: any) => {
    const db = store.getDb();
    const doc = db?.prepare('SELECT file_path, title FROM documents WHERE id = ?').get(d.documentId) as any;
    return {
      documentId: d.documentId,
      title: d.title || doc?.title || 'Untitled',
      retrievability: Math.round(d.retrievability * 100) / 100,
      lastAccess: d.lastAccess,
      filePath: doc?.file_path ? join(vaultPath, doc.file_path) : '',
    };
  }).filter((d: any) => d.filePath);
}

// ─── Self-write echo guard (W1-15) ───────────────────
// Paths written via IPC in the last 1500ms are skipped by the watcher so our
// own saves don't trigger a reindex + file:changed echo back to the renderer.

const SELF_WRITE_WINDOW_MS = 1500;
const recentSelfWrites = new Map<string, number>();

function noteSelfWrite(filePath: string): void {
  recentSelfWrites.set(resolve(filePath), Date.now());
  // Bounded cleanup — drop expired entries opportunistically.
  if (recentSelfWrites.size > 256) {
    const now = Date.now();
    for (const [p, ts] of recentSelfWrites) {
      if (now - ts > SELF_WRITE_WINDOW_MS) recentSelfWrites.delete(p);
    }
  }
}

function isSelfWrite(filePath: string): boolean {
  const key = resolve(filePath);
  const ts = recentSelfWrites.get(key);
  if (ts === undefined) return false;
  if (Date.now() - ts <= SELF_WRITE_WINDOW_MS) return true;
  recentSelfWrites.delete(key);
  return false;
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
    noteSelfWrite(safe); // W1-15 echo guard
    writeFileSync(safe, content, 'utf-8');
  });
  ipcMain.handle('vault:rename', (_e, oldPath: string, newPath: string) => {
    const safeOld = assertInsideVault(vp, oldPath);
    const safeNew = assertInsideVault(vp, newPath);
    noteSelfWrite(safeOld);
    noteSelfWrite(safeNew);
    renameSync(safeOld, safeNew);
  });
  ipcMain.handle('vault:delete', (_e, filePath: string) => {
    const safe = assertInsideVault(vp, filePath);
    noteSelfWrite(safe);
    if (statSync(safe).isDirectory()) {
      rmSync(safe, { recursive: true });
    } else {
      unlinkSync(safe);
    }
  });
  ipcMain.handle('vault:read-tree', () => buildFileTree(vp));
  ipcMain.handle('vault:create-file', (_e, filePath: string, content?: string) => {
    const safe = assertInsideVault(vp, filePath);
    // Stage D (W1-3) exists-guard — no silent clobber. Callers must check
    // 'vault:exists' first (or catch) if create-or-open semantics are wanted.
    if (existsSync(safe)) {
      throw new Error(`File already exists: ${basename(safe)}`);
    }
    mkdirSync(join(safe, '..'), { recursive: true });
    noteSelfWrite(safe);
    writeFileSync(safe, content ?? '', 'utf-8');
  });

  // ─── File operations (W1-3 / W1-9 / W1-10 — Stage D) ───

  // §4-G: UI deletion goes through the OS trash (recoverable). 'vault:delete'
  // above remains for programmatic permanent deletion but is not UI-exposed.
  ipcMain.handle('vault:trash', async (_e, filePath: string) => {
    const safe = assertInsideVault(vp, filePath);
    noteSelfWrite(safe);
    await shell.trashItem(safe);
  });

  // Duplicate a file or folder as "name (copy)" / "name (copy 2)" …
  // Returns the ABSOLUTE path of the new entry.
  ipcMain.handle('vault:duplicate', (_e, filePath: string): string => {
    const safe = assertInsideVault(vp, filePath);
    const isDir = statSync(safe).isDirectory();
    const ext = isDir ? '' : extname(safe);
    const base = basename(safe, ext);
    const dir = dirname(safe);
    let candidate = join(dir, `${base} (copy)${ext}`);
    let i = 2;
    while (existsSync(candidate)) {
      candidate = join(dir, `${base} (copy ${i})${ext}`);
      i += 1;
    }
    noteSelfWrite(candidate);
    if (isDir) cpSync(safe, candidate, { recursive: true });
    else copyFileSync(safe, candidate);
    return candidate;
  });

  ipcMain.handle('vault:exists', (_e, path: string): boolean => {
    const safe = assertInsideVault(vp, path);
    return existsSync(safe);
  });

  // Recursive file listing under a vault folder. Returns ABSOLUTE paths
  // (documented contract — renderer joins nothing). Optional extension filter,
  // accepted with or without the leading dot ('md' or '.md').
  ipcMain.handle('vault:list-files', (_e, dirPath: string, ext?: string): string[] => {
    const safe = assertInsideVault(vp, dirPath);
    const wanted = ext ? (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase() : null;
    const results: string[] = [];
    const walk = (dir: string): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // unreadable dir
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (!wanted || entry.name.toLowerCase().endsWith(wanted)) results.push(full);
      }
    };
    walk(safe);
    results.sort((a, b) => a.localeCompare(b));
    return results;
  });

  // W1-9: rename → update [[wikilinks]] across the vault. Line-based with
  // code-fence state tracking (``` / ~~~) so fenced code is never touched.
  // Matches [[old]], [[old|alias]], [[old#heading]]. Returns changed FILE count.
  ipcMain.handle('vault:update-links', (_e, oldTitle: string, newTitle: string): number => {
    if (!oldTitle?.trim() || !newTitle?.trim() || oldTitle === newTitle) return 0;
    const escaped = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // [[old immediately followed by ]] / | / # — lookahead keeps the delimiter.
    const pattern = new RegExp(`\\[\\[${escaped}(?=[\\]|#])`, 'g');
    const replacement = `[[${newTitle}`;
    const needle = `[[${oldTitle}`;
    let changedFiles = 0;

    const processFile = (full: string): void => {
      let content: string;
      try {
        content = readFileSync(full, 'utf-8');
      } catch {
        return;
      }
      if (!content.includes(needle)) return; // fast path
      let inFence = false;
      let fileChanged = false;
      const out = content.split('\n').map((line) => {
        if (/^\s*(```|~~~)/.test(line)) {
          inFence = !inFence;
          return line;
        }
        if (inFence) return line;
        const replaced = line.replace(pattern, replacement);
        if (replaced !== line) fileChanged = true;
        return replaced;
      });
      if (fileChanged) {
        noteSelfWrite(full); // register with the W1-15 watcher echo guard
        writeFileSync(full, out.join('\n'), 'utf-8');
        changedFiles += 1;
      }
    };

    const walk = (dir: string): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) processFile(full);
      }
    };
    walk(vp);
    return changedFiles;
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
    const result = await core.indexVault(vp, { store, embedder, chunkOptions: coreChunkOptions });
    return { indexed: result.indexed, totalChunks: result.totalChunks };
  });

  ipcMain.handle('core:decay-top', async (_e, limit?: number) => {
    try {
      return await getDecayItems(vp, limit ?? 5);
    } catch (err) {
      console.error('[main] core:decay-top failed:', err);
      return [];
    }
  });

  // W1-14: generalized decay list for the Memory review queue (decay-top kept above).
  ipcMain.handle('core:decay-list', async (_e, limit?: number) => {
    try {
      return await getDecayItems(vp, limit ?? 20);
    } catch (err) {
      console.error('[main] core:decay-list failed:', err);
      return [];
    }
  });

  // W1-14: FSRS loop — record an access event for a note.
  // DEVIATION from plan: core's recordAccess (AccessEvent.type 'view'|'search'|
  // 'mcp_query') has no FSRS grade parameter — every access fully resets R to 1.0.
  // So 'open' and 'review' map to the same 'view' strength for now; weak/strong
  // grading needs a core API change (tracked as Wave-2 follow-up).
  ipcMain.handle('core:record-access', async (_e, filePath: string, _kind: 'open' | 'review') => {
    if (!coreReady || !decayEngine) return;
    try {
      const safe = assertInsideVault(vp, filePath);
      const documentId = docIdForFile(vp, safe);
      await decayEngine.recordAccess({
        documentId,
        type: 'view',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[main] core:record-access failed:', err);
    }
  });

  // W1-4: full search panel — hybrid/keyword modes + tag/path filters.
  // keyword mode = semantic signal off (BM25 + exact-entity only) via the
  // per-query signalWeights override; core has no keyword-only entry point.
  ipcMain.handle('search:query', async (_e, query: string, opts?: SearchQueryOpts): Promise<SearchResult[]> => {
    if (!coreReady || !searchEngine || !query?.trim()) return [];
    try {
      const limit = Math.min(opts?.limit ?? 20, 100);
      // Over-fetch when a post-hoc path filter will discard results.
      const fetchLimit = opts?.pathPrefix ? Math.min(limit * 3, 100) : limit;
      const results = await searchEngine.search({
        query,
        limit: fetchLimit,
        ...(opts?.tags?.length ? { tags: opts.tags } : {}),
        ...(opts?.mode === 'keyword' ? { signalWeights: { semantic: 0, recency: 0 } } : {}),
      });
      let mapped: SearchResult[] = results.map((r: any) => mapCoreSearchResult(vp, r));
      if (opts?.pathPrefix) {
        const prefix = opts.pathPrefix.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
        mapped = mapped.filter((r) => toVaultRel(vp, r.filePath).toLowerCase().startsWith(prefix));
      }
      return mapped.slice(0, limit);
    } catch (err) {
      console.error('[main] search:query failed:', err);
      return [];
    }
  });

  // W1-6: tag aggregation — core store exposes getTopics() (json_each over the
  // tags column); raw SQL fallback keeps older core versions working.
  ipcMain.handle('tags:list', async (): Promise<{ tag: string; count: number }[]> => {
    if (!coreReady || !store) return [];
    try {
      if (typeof store.getTopics === 'function') {
        const topics = await store.getTopics();
        return topics.map((t: any) => ({ tag: t.topic, count: t.count }));
      }
      const db = store.getDb();
      if (!db) return [];
      return db.prepare(`
        SELECT je.value AS tag, COUNT(DISTINCT d.id) AS count
        FROM documents d, json_each(d.tags) je
        GROUP BY je.value
        ORDER BY count DESC
      `).all();
    } catch (err) {
      console.error('[main] tags:list failed:', err);
      return [];
    }
  });

  // W1-13: Ask panel — core askVault is fully local (search + structured
  // composition, no LLM). Degraded mode: empty answer + citations from a
  // plain hybrid search so the UI can render citations-only.
  ipcMain.handle('core:ask', async (_e, question: string): Promise<AskResponse> => {
    if (!coreReady || !searchEngine || !question?.trim()) return { answer: '', citations: [] };
    try {
      const core = await import('@stellavault/core');
      if (typeof (core as any).askVault === 'function') {
        const res = await (core as any).askVault(searchEngine, question, { limit: 8 });
        return {
          answer: res?.answer ?? '',
          citations: (res?.sources ?? []).map((s: any) => ({
            filePath: s.filePath ? join(vp, s.filePath) : '',
            title: s.title ?? 'Untitled',
            snippet: s.snippet ?? '',
          })).filter((c: any) => c.filePath),
        };
      }
    } catch (err) {
      console.error('[main] core:ask failed — falling back to citations-only:', err);
    }
    try {
      const results = await searchEngine.search({ query: question, limit: 5 });
      return {
        answer: '',
        citations: results.map((r: any) => {
          const m = mapCoreSearchResult(vp, r);
          return { filePath: m.filePath, title: m.title, snippet: m.snippet };
        }).filter((c: any) => c.filePath),
      };
    } catch {
      return { answer: '', citations: [] };
    }
  });

  // W1-16: related notes — mirrors core's get-related MCP tool (doc title +
  // content head as the query, self excluded). Unindexed notes → [].
  ipcMain.handle('core:related', async (_e, filePath: string, limit?: number): Promise<SearchResult[]> => {
    if (!coreReady || !store || !searchEngine) return [];
    try {
      const safe = assertInsideVault(vp, filePath);
      const documentId = docIdForFile(vp, safe);
      const doc = await store.getDocument(documentId);
      if (!doc) return [];
      const lim = limit ?? 5;
      const results = await searchEngine.search({
        query: `${doc.title} ${(doc.content ?? '').slice(0, 200)}`,
        limit: lim + 1, // +1 to drop self
      });
      return results
        .filter((r: any) => r.document?.id !== documentId)
        .slice(0, lim)
        .map((r: any) => mapCoreSearchResult(vp, r));
    } catch (err) {
      console.error('[main] core:related failed:', err);
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
    // T1-13: drop invalid fields (negative window size, bad theme/accent) before
    // they persist + re-apply. Pure, unit-tested in tests/settings-validate.test.ts.
    const merged = settingsStore.set(validateSettingsPatch(patch ?? {}));
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

  // ─── App menu (W2) — zoom + shell helpers ───────────
  // window:zoom — webContents zoom factor, clamped 0.5..3.0.
  ipcMain.handle('window:zoom', (e, action: 'in' | 'out' | 'reset'): number => {
    const wc = e.sender;
    const next = action === 'reset'
      ? 1
      : Math.min(3, Math.max(0.5, wc.getZoomFactor() + (action === 'in' ? 0.1 : -0.1)));
    wc.setZoomFactor(next);
    return next;
  });

  // shell:open-path — reveal a folder/file in the OS file manager.
  // Restricted to paths inside the vault root (same boundary as vault FS handlers).
  ipcMain.handle('shell:open-path', async (_e, path: string) => {
    const safe = assertInsideVault(vp, path);
    const err = await shell.openPath(safe);
    if (err) throw new Error(`Failed to open path: ${err}`);
  });

  // shell:open-external — https-only allowlist (no file:, javascript:, http:).
  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('Invalid URL'); }
    if (parsed.protocol !== 'https:') throw new Error('Only https:// URLs are allowed');
    await shell.openExternal(parsed.toString());
  });

  // ─── [editor-upgrade agent owned block — vault:import-asset ONLY] ───
  // Copies an image into <vault>/assets/ and returns the VAULT-RELATIVE path
  // (forward slashes) for Obsidian-compatible ![](assets/name.png) markdown.
  // Accepts base64 bytes from the renderer file picker.
  //
  // T1-1 (security): the legacy `srcPath` branch — copyFileSync(resolve(srcPath))
  // — was an ARBITRARY local-file read into the vault (then readable via
  // vault:read-file), bypassing the entire path-safety model. The renderer only
  // ever sends base64 (MarkdownEditor.tsx:194), so the branch was dead but live.
  // It is removed; only the bytes path remains.
  ipcMain.handle('vault:import-asset', (_e, payload: { base64?: string; fileName: string }): string => {
    if (!payload || !payload.base64) {
      throw new Error('vault:import-asset: base64 required');
    }
    // Strip directory components + whitelist-sanitize the filename (pure helper).
    const { ext, base } = sanitizeAssetName(payload.fileName);

    const assetsDir = join(vp, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    let target = join(assetsDir, `${base}${ext}`);
    let i = 2;
    while (existsSync(target)) target = join(assetsDir, `${base}-${i++}${ext}`);
    assertInsideVault(vp, target); // CRIT-01 invariant, defense-in-depth

    noteSelfWrite(target); // W1-15 watcher echo guard
    const buf = Buffer.from(payload.base64, 'base64');
    assertAssetSize(buf.byteLength); // empty / 50MB cap (pure helper)
    writeFileSync(target, buf);
    return toVaultRel(vp, target);
  });
  // ─── [end editor-upgrade agent block] ───
}

// ─── File watcher (W1-15) ────────────────────────────
// Watches the vault for external *.md changes (Obsidian, Notion sync daemon,
// manual edits), debounce-batches 800ms, then (a) incrementally reindexes via
// core indexVault (content-hash skip makes a vault pass cheap — only changed
// docs re-embed) and (b) emits the already-declared 'file:changed' event per
// path. Our own IPC writes are skipped via the self-write echo guard above.
// chokidar is a core dep, declared external in vite.main.config.ts + bundled
// by forge — dynamic import resolves at runtime; fs.watch recursive fallback.

const WATCH_DEBOUNCE_MS = 800;
let watcherStarted = false;

function startVaultWatcher(config: AppConfig): void {
  if (watcherStarted || !config.vaultPath) return;
  watcherStarted = true;
  const vp = config.vaultPath;

  let pending = new Map<string, 'add' | 'change' | 'unlink'>();
  let timer: NodeJS.Timeout | null = null;
  let flushing = false;
  let pendingFlush = false;

  const flush = async (): Promise<void> => {
    timer = null;
    if (flushing) { pendingFlush = true; return; }
    flushing = true;
    try {
      do {
        pendingFlush = false;
        const batch = pending;
        pending = new Map();
        if (batch.size === 0) break;
        // Incremental reindex — indexVault skips unchanged docs by content hash.
        if (coreReady && store && embedder) {
          try {
            const core = await import('@stellavault/core');
            await core.indexVault(vp, { store, embedder, chunkOptions: coreChunkOptions });
          } catch (err) {
            console.error('[main] watcher reindex failed:', err);
          }
        }
        for (const [filePath, event] of batch) {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('file:changed', { filePath, event });
          }
        }
      } while (pendingFlush);
    } finally {
      flushing = false;
    }
  };

  const schedule = (filePath: string, event: 'add' | 'change' | 'unlink'): void => {
    if (!filePath.endsWith('.md')) return;
    if (isSelfWrite(filePath)) return; // echo guard
    pending.set(filePath, event);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, WATCH_DEBOUNCE_MS);
  };

  void (async () => {
    try {
      const chokidarMod: any = await import('chokidar');
      const watch = chokidarMod.watch ?? chokidarMod.default?.watch;
      if (typeof watch !== 'function') throw new Error('chokidar.watch not found');
      const watcher = watch(vp, {
        ignored: /(^|[\/\\])\.|node_modules/,
        persistent: true,
        ignoreInitial: true,
      });
      watcher.on('add', (p: string) => schedule(resolve(p), 'add'));
      watcher.on('change', (p: string) => schedule(resolve(p), 'change'));
      watcher.on('unlink', (p: string) => schedule(resolve(p), 'unlink'));
      watcher.on('error', (err: unknown) => console.error('[main] watcher error:', err));
      return;
    } catch (err) {
      console.error('[main] chokidar unavailable — falling back to fs.watch:', err);
    }
    try {
      // win32/darwin support { recursive: true }.
      fsWatch(vp, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const full = resolve(join(vp, filename.toString()));
        schedule(full, existsSync(full) ? 'change' : 'unlink');
      });
    } catch (err) {
      console.error('[main] fs.watch failed — vault watcher disabled:', err);
    }
  })();
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

  // T1-5: defense-in-depth navigation lockdown (sandbox already mitigates, this
  // closes the gap explicitly). Deny window.open / target=_blank entirely — any
  // external link goes through the vetted shell:open-external https allowlist.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Block navigation away from our own app origin (file:// renderer or the Vite
  // dev server). A renderer compromise can't redirect the window to a remote URL.
  win.webContents.on('will-navigate', (event, url) => {
    let allowed = false;
    try {
      const target = new URL(url);
      if (target.protocol === 'file:') allowed = true;
      else if (MAIN_WINDOW_VITE_DEV_SERVER_URL && url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)) allowed = true;
    } catch { /* unparseable URL → blocked */ }
    if (!allowed) {
      event.preventDefault();
      console.warn('[main] blocked navigation to non-app origin:', url);
    }
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
      // T1-10: multilingual MiniLM (384d, drop-in) — see fallback config above.
      embedding: { model: 'local', localModel: 'paraphrase-multilingual-MiniLM-L12-v2' },
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

// ─── Process-level error guards (T1-4) ───────────────
// An unguarded async IPC rejection or thrown error in main would otherwise
// terminate the whole app silently (the renderer ErrorBoundary covers only the
// renderer) → loss of unsaved work. Log instead of crashing; for a truly
// uncaught synchronous exception also surface a dialog so the failure is visible
// rather than a frozen/dead window. We deliberately do NOT exit — keeping the
// window alive lets the user save in-flight edits.

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
  try {
    if (app.isReady() && BrowserWindow.getAllWindows().length > 0) {
      dialog.showErrorBox(
        'Stellavault — unexpected error',
        `An internal error occurred but the app is still running.\n\n${err?.stack || err?.message || String(err)}`,
      );
    }
  } catch { /* dialog best-effort — never let the handler itself throw */ }
});

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
    // W1-15: start after core init so the first change-batch can reindex
    // immediately. Events still flow if core failed (reindex is guarded).
    startVaultWatcher(config);
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
