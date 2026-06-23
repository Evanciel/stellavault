// Stellavault Desktop — Main Process
// Owns: native modules (SQLite, embedder), file system, IPC handlers, window management.

import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import { join, relative, resolve, dirname, basename, extname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync, rmSync, copyFileSync, cpSync, watch as fsWatch, promises as fsp } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import type { AppSettings, FileTreeNode, SearchResult, SearchQueryOpts, AskResponse, VaultStats, DecayItem, CoachGaps, CoachLearningPath, PublishStatus, VaultRegistryEntry, CrossVaultResult, SynthesisResult, ContradictionNudge, DuplicateNudge, DecisionInput, DecisionEntry, EvolutionEntry, AutoLinkResult, LinkSuggestion, McpStatus } from '../shared/ipc-types.js';
import type { Server as HttpServer } from 'node:http';
import { SettingsStore } from './settings-store.js';
import { SecretStore } from './secret-store.js';
import { migrateLegacyApiKey } from './migrate-legacy-api-key.js';
import { assertInsideVault, sanitizeAssetName, assertAssetSize } from './path-safety.js';
import { OrchestrationEngine } from './orchestration/engine.js';
import { createQueueDao } from './orchestration/queue-dao.js';
import type { CaptureRequest } from '../shared/ipc-types.js';
import type { ClusteredGraph } from '@stellavault/core';
import { validateSettingsPatch } from './settings-validate.js';
import { redactSecrets } from './redact-secrets.js';
// T3-2 / T3-1: LLM synthesizer (Anthropic Messages API over net.request). Built
// from desktop-settings.ai when an API key is configured; null → extractive.
import { makeSynthesizer, type LlmConfig } from './llm-synthesizer.js';
import { modelsListRequest, parseModelsResponse, isValidProvider, type AiProvider } from '../shared/ai-providers.js';
// SP1 multiturn chat (multimedia-chat-sp1-plan §3, §4) — streaming engine + plaintext
// session store. chatStream calls the configured provider DIRECTLY (net.request), the
// store persists UUID-named JSON sessions. Both live in main; the API key never leaves.
import { chatStream, MAX_CONCURRENT, type ErrorCategory } from './chat-engine.js';
import { buildAgentToolset, buildExecuteAgentTool } from './agent-tools.js';
// "Start Ollama" helper — probe reachability + spawn `ollama serve` (fixed binary).
import {
  ollamaStatus,
  startOllama,
  getOllamaVersion,
  checkCompat,
  downloadAndInstallOllama,
} from './ollama-manager.js';
import {
  saveSession as chatSaveSession,
  loadSession as chatLoadSession,
  listSessions as chatListSessions,
  renameSession as chatRenameSession,
  deleteSession as chatDeleteSession,
  isUuid as chatIsUuid,
} from './chat-session-store.js';
import type { ChatMessage } from '../shared/ipc-types.js';

// ─── Asset protocol (T2-1) ───────────────────────────
// Vault-relative images (![](assets/x.png)) can't load from a file:// renderer
// under CSP, and base64 is the only thing that rendered before. We register a
// privileged custom scheme `app://vault/<relpath>` whose handler streams the
// file straight off disk — but ONLY after assertInsideVault, so the renderer
// can never read outside the vault via a crafted src. Registration MUST happen
// BEFORE app `ready`; the actual protocol.handle wiring is in whenReady once the
// vault path is known. img-src in the renderer CSP is widened to `app:`.
const ASSET_SCHEME = 'app';
protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { secure: true, stream: true, supportFetchAPI: true, bypassCSP: false },
  },
]);

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
// T2-Task2: API keys are read from SecretStore (safeStorage-backed), NEVER from
// desktop-settings.json at runtime. secretStore is null until app.whenReady()
// (safeStorage is only valid after the app is ready).
let secretStore: SecretStore | null = null;

// T2-18: windows whose dirty-close round-trip has been confirmed (renderer said
// proceed). The 'close' handler lets these through instead of re-prompting.
const closeConfirmed = new WeakSet<BrowserWindow>();

// A vault switch deferred until the dirty-close round-trip confirms. Writing the
// bootstrap config then calling app.quit() races the dirty-close guard: the guard
// can veto the quit (Cancel / save-fail), leaving ~/.stellavault.json pointing at a
// vault the running session never loaded. We instead stash the target here and
// commit it in window:confirm-close, i.e. ONLY on a path that actually relaunches.
let pendingVaultSwitch: { id: string; path: string; dbPath?: string } | null = null;

function broadcastSettingsChanged(settings: AppSettings): void {
  // Redact secrets BEFORE sending to any renderer window — the broadcast path
  // is as dangerous as settings:get if left unguarded.
  const safe = redactSecrets(
    settings,
    (p) => !!secretStore?.hasSecret(p),
    secretStore?.isPersistent() ?? false,
  );
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('settings:changed', safe);
  }
}

// T3-2 / multi-provider: read the persisted AI provider/model/baseURL from
// desktop-settings, but the apiKey from SecretStore (safeStorage-backed).
// NEVER log the result — the key is only ever handed to makeSynthesizer (which sends
// it to the selected provider's endpoint).
function getAiConfig(): LlmConfig | undefined {
  try {
    if (!settingsStore) settingsStore = new SettingsStore();
    const ai = settingsStore.get().ai as Omit<LlmConfig, 'apiKey'> & { apiKey?: string } | undefined;
    if (!ai) return undefined;
    const provider = ai.provider;
    const apiKey = provider ? (secretStore?.getSecret(provider) ?? '') : '';
    return { ...ai, apiKey } as LlmConfig;
  } catch {
    return undefined;
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
// T3-3: the active vault path, captured at initCore — passed to the embedded MCP
// server (vaultPath-dependent tools like decision-journal need it).
let currentVaultPath = '';
// Second-brain auto-capture engine (Design §6.1) — created at the end of initCore.
let engine: OrchestrationEngine | null = null;

// ─── SP1 multiturn chat (multimedia-chat-sp1-plan §3) ────────────────────────
// In-flight chat streams keyed by renderer-supplied streamId. Each entry pins the
// AbortController (for chat:abort + before-quit) and the originating webContents id
// (wcId) so abort/cap can be authorised against the owner. Created BEFORE the RAG
// await in chat:send so an in-flight search is cancellable; deleted in finally with
// an identity guard. NEVER carries the API key.
interface ChatStreamEntry { controller: AbortController; wcId: number; }
const chatStreamRegistry = new Map<string, ChatStreamEntry>();

// Agent (SP-D): a write tool pauses the loop on a per-stream approval promise; the
// renderer's chat:tool-approve resolves it. Keyed by streamId; owner-checked by wcId.
// Cleaned up on resolve / abort / chat:send finally so a blocked await never leaks the
// cap-of-2 slot. Default on any teardown = DENY.
const pendingApprovals = new Map<string, { resolve: (v: boolean) => void; wcId: number }>();
const CHAT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_MAX_MESSAGES = 100;
const CHAT_MAX_MSG_CHARS = 24_000;
const CHAT_MAX_TOTAL_CHARS = 120_000;

// Validate + sanitise a renderer chat:send request. Returns the cleaned turns
// (renderer-supplied 'system' roles DROPPED — main owns the system prompt) or a
// rejection reason. Caps message count / per-message length / total length.
function validateChatReq(
  req: any,
): { ok: true; clean: ChatMessage[] } | { ok: false; msg: string } {
  if (!req || typeof req.streamId !== 'string' || !CHAT_UUID_RE.test(req.streamId)) {
    return { ok: false, msg: 'bad streamId' };
  }
  if (chatStreamRegistry.has(req.streamId)) return { ok: false, msg: 'duplicate streamId' };
  if (typeof req.sessionId !== 'string' || !chatIsUuid(req.sessionId)) {
    return { ok: false, msg: 'bad sessionId' };
  }
  if (!Array.isArray(req.messages) || req.messages.length === 0 || req.messages.length > CHAT_MAX_MESSAGES) {
    return { ok: false, msg: 'bad messages' };
  }
  let total = 0;
  const clean: ChatMessage[] = [];
  for (const m of req.messages) {
    if (!m || typeof m.text !== 'string') return { ok: false, msg: 'bad message text' };
    // role whitelist: a 'system' turn must NEVER come from the renderer.
    if (m.role !== 'user' && m.role !== 'assistant') return { ok: false, msg: 'bad role' };
    if (m.text.length > CHAT_MAX_MSG_CHARS) return { ok: false, msg: 'message too long' };
    total += m.text.length;
    clean.push({ id: String(m.id ?? ''), role: m.role, text: m.text, ts: Number(m.ts) || Date.now() });
  }
  if (total > CHAT_MAX_TOTAL_CHARS) return { ok: false, msg: 'conversation too long' };
  return { ok: true, clean };
}

// ─── Agent Memory / MCP server (T3-3) ────────────────
// The embedded MCP server ("Agent Memory") lets a local agent (Claude) read/write
// the FSRS-pruned vault over MCP. It is OFF by default and toggled from Settings.
// We keep the running handle + a small in-process activity ring buffer (tool name
// + short detail) that the server's onToolCall callback feeds; both surface via
// 'mcp:status' / the 'mcp:status-changed' event. Bound to 127.0.0.1 only.
const MCP_DEFAULT_PORT = 3334;        // core startHttp default (loopback only)
const MCP_TOOL_COUNT = 21;            // 21 tools per project spec (createMcpServer)
const MCP_ACTIVITY_MAX = 20;
let mcpHandle: { port: number; close: () => Promise<void> } | null = null;
let mcpStarting = false;
let mcpLastError: string | undefined;
const mcpActivity: { tool: string; detail: string; ts: number }[] = [];

function mcpStatus(): { running: boolean; port: number; toolCount: number; recent: typeof mcpActivity; error?: string } {
  return {
    running: !!mcpHandle,
    port: mcpHandle?.port ?? MCP_DEFAULT_PORT,
    toolCount: MCP_TOOL_COUNT,
    recent: mcpActivity.slice(0, MCP_ACTIVITY_MAX),
    error: mcpLastError,
  };
}

function broadcastMcpStatus(): void {
  const status = mcpStatus();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('mcp:status-changed', status);
  }
}

function recordMcpActivity(info: { tool: string; detail: string }): void {
  mcpActivity.unshift({ tool: info.tool, detail: info.detail, ts: Date.now() });
  if (mcpActivity.length > MCP_ACTIVITY_MAX) mcpActivity.length = MCP_ACTIVITY_MAX;
  broadcastMcpStatus();
}

async function startMcpServer(): Promise<void> {
  if (mcpHandle || mcpStarting) return;
  if (!coreReady || !store || !searchEngine) {
    mcpLastError = 'Core is still initializing — try again in a moment.';
    broadcastMcpStatus();
    return;
  }
  mcpStarting = true;
  mcpLastError = undefined;
  try {
    const core = await import('@stellavault/core');
    const server = (core as any).createMcpServer({
      store,
      searchEngine,
      embedder,
      decayEngine,
      vaultPath: currentVaultPath,
      onToolCall: recordMcpActivity,
    });
    // startHttp returns a closable handle (core T3-3 addition); guard for older core.
    const handle = await server.startHttp(MCP_DEFAULT_PORT);
    if (handle && typeof handle.close === 'function') {
      mcpHandle = { port: handle.port ?? MCP_DEFAULT_PORT, close: handle.close };
    } else {
      // Older core without a closable handle — running but non-stoppable.
      mcpHandle = { port: MCP_DEFAULT_PORT, close: async () => { /* no-op */ } };
    }
  } catch (err) {
    mcpLastError = err instanceof Error ? err.message : String(err);
    console.error('[main] MCP server start failed:', err);
  } finally {
    mcpStarting = false;
    broadcastMcpStatus();
  }
}

async function stopMcpServer(): Promise<void> {
  if (!mcpHandle) return;
  try {
    await mcpHandle.close();
  } catch (err) {
    console.error('[main] MCP server stop failed:', err);
  } finally {
    mcpHandle = null;
    broadcastMcpStatus();
  }
}

// ─── Graph build cache (T2-7) ────────────────────────
// GraphView (main pane) + GraphPanel (right panel) both call 'graph:build' on
// mount → the build used to run TWICE per open. Cache by (mode, index version):
// graphCacheVersion is bumped on any reindex (core:index) or watcher-detected
// file change so a stale layout is never served after the vault changes.
let graphCacheVersion = 0;
const graphBuildCache = new Map<string, { nodes: unknown[]; edges: unknown[] }>();
const graphBuildInflight = new Map<string, Promise<{ nodes: unknown[]; edges: unknown[] }>>();
// Wave 1 cluster-first LOD: cache the tiered ClusteredGraph per (mode, version).
const clusteredCache = new Map<string, ClusteredGraph>();
const clusteredInflight = new Map<string, Promise<ClusteredGraph | null>>();
function bumpGraphCacheVersion(): void {
  graphCacheVersion++;
  graphBuildCache.clear();
  clusteredCache.clear();
  // In-flight builds for the old version still resolve their own callers; they
  // just won't be cached under the new key (their finally only deletes the old
  // inflight entry). Next call rebuilds against the fresh index.
}

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
    currentVaultPath = config.vaultPath; // T3-3: MCP server vaultPath-dependent tools
    coreChunkOptions = { ...coreChunkOptions, ...hubConfig.chunking };
    const hub = core.createKnowledgeHub(hubConfig);
    await hub.store.initialize();
    // ★PERF: do NOT block coreReady on the ~470MB model load (~30-50s). The graph,
    // file tree, and editor need zero embeddings → make them usable in seconds and warm
    // the model in the background. embed()/embedBatch() lazy-init the (memoized) pipeline,
    // so capture/search/ask arriving before it's ready simply await the in-flight load.
    void hub.embedder.initialize().catch((err) => {
      console.error('[main] embedder background init failed (AI features retry on use):', err);
    });
    store = hub.store;
    searchEngine = hub.searchEngine;
    embedder = hub.embedder;

    // T2-15: use the SAME DecayEngine the hub's search recency re-rank uses,
    // instead of constructing a standalone `new core.DecayEngine(db)`. The hub
    // exposes its lazy getDecayEngine (memoized over the same DB) — recordAccess
    // and the ±10% recency re-rank now share one instance, so grades recorded
    // here are live in search ranking. Fall back to the standalone constructor
    // for older core builds that don't return getDecayEngine.
    try {
      if (typeof (hub as any).getDecayEngine === 'function') {
        decayEngine = (hub as any).getDecayEngine();
      } else {
        const dbInstance = store.getDb();
        if (dbInstance) decayEngine = new core.DecayEngine(dbInstance);
      }
      // ★PERF: seed FSRS decay in the BACKGROUND. initializeNewDocuments loads every
      // missing doc's FULL content (line decay-engine.ts:249) — on a 12k-note / cold-disk
      // vault that's tens of seconds, and it was awaited here BEFORE coreReady, blocking
      // the whole app ("Waiting for AI engine…"). It gates nothing the graph/editor need.
      if (decayEngine) void decayEngine.initializeNewDocuments().catch((e: unknown) => console.error('[main] decay seed skipped:', e));
    } catch (err) {
      console.error('[main] DecayEngine init skipped:', err);
    }

    coreReady = true;

    // ─── Second-brain auto-capture engine (Design §6.1) ───
    // Wires the persisted capture queue + classify DAO (same index DB) to the reused
    // core funnel (ingest → classify → index → decay). Frontmatter mode: classification
    // is recorded in the DAO; existing vault files are never moved.
    try {
      const captureDb = store.getDb();
      if (captureDb) {
        const captureVaultPath = config.vaultPath;
        engine = new OrchestrationEngine({
          vaultPath: captureVaultPath,
          queue: createQueueDao(captureDb),
          classifyDao: core.createClassifyDao(captureDb),
          cfg: core.DEFAULT_CLASSIFY_CONFIG,
          ingest: (vaultPath, input) => core.ingest(vaultPath, input),
          extractFile: async (p) => {
            const ex = await core.extractFileContent(p);
            return { text: ex.text, title: ex.metadata?.title, sourceFormat: ex.sourceFormat };
          },
          classify: (ctx, cats, cfg) => core.classifyLocal(ctx, cats, cfg),
          embed: (text: string) => embedder.embed(text),
          indexFile: async (abs: string) => {
            noteSelfWrite(abs); // W1-15 echo guard — our own write
            if (typeof (core as any).indexFiles === 'function') {
              await (core as any).indexFiles(captureVaultPath, [abs], { store, embedder, chunkOptions: coreChunkOptions });
            } else {
              await core.indexVault(captureVaultPath, { store, embedder, chunkOptions: coreChunkOptions });
            }
            bumpVaultFsVersion();
            bumpGraphCacheVersion();
          },
          recordCapture: (abs: string) => {
            if (decayEngine) {
              const documentId = docIdForFile(captureVaultPath, abs);
              void decayEngine.recordAccess({ documentId, type: 'view', timestamp: new Date().toISOString() }).catch(() => {});
            }
          },
          emit: (channel: string, payload: unknown) => {
            for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
          },
          isReady: () => coreReady,
        });
        engine.start();
      }
    } catch (err) {
      console.error('[main] capture engine init skipped:', err);
    }
  } catch (err) {
    console.error('[main] Core init failed:', err);
  }
}

// ─── File tree builder ───────────────────────────────
// T2-8: the former sync buildFileTree / collectAllNotes were moved into the
// async + cached "[T2-8 owned block]" below (buildFileTreeAsync/getFileTree,
// walkMarkdownFiles/getAllNoteTitles) to keep the main thread free on big vaults.

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
  bumpVaultFsVersion(); // T2-8: every IPC vault mutation funnels here → invalidate FS-scan caches
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

// ─── [T2-8 owned block — async/cached full-vault FS scans] ───────────
// Full-vault sync scans (backlinks:find, vault:update-links, buildFileTree/
// collectAllNotes) blocked the main thread on note-open/rename → UI jank on
// big (8k+) vaults. This block makes them async (fs.promises) and caches the
// read-heavy ones (file tree, note titles, backlinks) by an FS version that is
// bumped on every vault mutation — IPC self-writes (noteSelfWrite paths) and the
// external file watcher both invalidate via bumpVaultFsVersion(). Behavior is
// identical to the previous sync versions; only sync→async+cache changed.

let vaultFsVersion = 0;
/** Invalidate all T2-8 caches. Called on any vault mutation (IPC writes/renames/
 *  deletes/folder-creates) and from the file watcher on external changes. */
function bumpVaultFsVersion(): void {
  vaultFsVersion += 1;
}

// Async recursive directory walk yielding *.md absolute paths. Skips hidden +
// node_modules dirs (same filter as the old sync walkers). Depth-limited to
// mirror buildFileTree's safety cap and bound a pathological symlink loop.
async function walkMarkdownFiles(dirPath: string, depth = 0): Promise<string[]> {
  if (depth > 20) return [];
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return []; // unreadable dir
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walkMarkdownFiles(full, depth + 1));
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

// Async file-tree builder (replaces the sync buildFileTree). Cached by FS version.
async function buildFileTreeAsync(dirPath: string, depth = 0): Promise<FileTreeNode[]> {
  if (depth > 10) return []; // Safety limit (parity with old sync buildFileTree)
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: FileTreeNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: fullPath,
        isDir: true,
        children: await buildFileTreeAsync(fullPath, depth + 1),
      });
    } else if (entry.name.endsWith('.md')) {
      nodes.push({ name: entry.name, path: fullPath, isDir: false });
    }
  }
  // Sort: folders first, then alphabetical (parity with old sync version).
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

let fileTreeCache: { version: number; tree: FileTreeNode[] } | null = null;
async function getFileTree(vaultPath: string): Promise<FileTreeNode[]> {
  if (fileTreeCache && fileTreeCache.version === vaultFsVersion) return fileTreeCache.tree;
  const tree = await buildFileTreeAsync(vaultPath);
  fileTreeCache = { version: vaultFsVersion, tree };
  return tree;
}

let noteTitlesCache: { version: number; titles: string[] } | null = null;
async function getAllNoteTitles(vaultPath: string): Promise<string[]> {
  if (noteTitlesCache && noteTitlesCache.version === vaultFsVersion) return noteTitlesCache.titles;
  const files = await walkMarkdownFiles(vaultPath);
  const titles = files.map((f) => basename(f).replace(/\.md$/, ''));
  noteTitlesCache = { version: vaultFsVersion, titles };
  return titles;
}

// Backlinks cache: keyed by FS version → per-title results. A note-open scans the
// whole vault once per version, then every subsequent open in that version (e.g.
// tab-switching, hover previews) is a Map hit. Bounded so an active session that
// opens hundreds of notes can't grow it without limit.
const BACKLINKS_CACHE_MAX = 512;
let backlinksCache: { version: number; byTitle: Map<string, Array<{ filePath: string; name: string; line: string }>> } | null = null;
async function findBacklinks(vaultPath: string, title: string): Promise<Array<{ filePath: string; name: string; line: string }>> {
  if (!backlinksCache || backlinksCache.version !== vaultFsVersion) {
    backlinksCache = { version: vaultFsVersion, byTitle: new Map() };
  }
  const cached = backlinksCache.byTitle.get(title);
  if (cached) return cached;

  const pattern = `[[${title}]]`;
  const files = await walkMarkdownFiles(vaultPath);
  const results: Array<{ filePath: string; name: string; line: string }> = [];
  // Read files concurrently in bounded chunks — keeps memory/FD use sane on huge
  // vaults while staying off the main thread (vs the old blocking readFileSync loop).
  const CONCURRENCY = 32;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const slice = files.slice(i, i + CONCURRENCY);
    const read = await Promise.all(slice.map(async (full) => {
      try {
        const content = await fsp.readFile(full, 'utf-8');
        if (!content.includes(pattern)) return null;
        const lineMatch = content.split('\n').find((l) => l.includes(pattern));
        return {
          filePath: full,
          name: basename(full).replace(/\.md$/, ''),
          line: (lineMatch ?? '').trim().slice(0, 120),
        };
      } catch {
        return null; // skip unreadable
      }
    }));
    for (const r of read) if (r) results.push(r);
  }

  if (backlinksCache.byTitle.size >= BACKLINKS_CACHE_MAX) backlinksCache.byTitle.clear();
  backlinksCache.byTitle.set(title, results);
  return results;
}
// ─── [end T2-8 owned block] ───

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
  ipcMain.handle('vault:read-tree', () => getFileTree(vp)); // T2-8: async + cached by FS version
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
  // T2-8: async (fs.promises) + batched concurrency - whole-vault rewrite off the
  // main thread on rename. Same line/fence semantics; each rewritten file still
  // goes through noteSelfWrite (W1-15 echo guard). Mutating op -> bumpVaultFsVersion().
  ipcMain.handle('vault:update-links', async (_e, oldTitle: string, newTitle: string): Promise<number> => {
    if (!oldTitle?.trim() || !newTitle?.trim() || oldTitle === newTitle) return 0;
    const escaped = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // [[old immediately followed by ]] / | / # — lookahead keeps the delimiter.
    const pattern = new RegExp(`\\[\\[${escaped}(?=[\\]|#])`, 'g');
    const replacement = `[[${newTitle}`;
    const needle = `[[${oldTitle}`;
    let changedFiles = 0;

    const processFile = async (full: string): Promise<void> => {
      let content: string;
      try {
        content = await fsp.readFile(full, 'utf-8');
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
        await fsp.writeFile(full, out.join('\n'), 'utf-8');
        changedFiles += 1;
      }
    };

    // Async walk (shared T2-8 helper) -> process in bounded concurrent batches so a
    // large vault doesn't open thousands of FDs at once.
    const files = await walkMarkdownFiles(vp);
    const CONCURRENCY = 32;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      await Promise.all(files.slice(i, i + CONCURRENCY).map(processFile));
    }
    if (changedFiles > 0) bumpVaultFsVersion(); // links rewritten -> invalidate caches
    return changedFiles;
  });
  ipcMain.handle('vault:create-folder', (_e, folderPath: string) => {
    const safe = assertInsideVault(vp, folderPath);
    mkdirSync(safe, { recursive: true });
  });
  ipcMain.handle('vault:list-notes', () => getAllNoteTitles(vp)); // T2-8: async + cached by FS version

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
    bumpGraphCacheVersion(); // T2-7: a manual reindex changes the graph
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

  // W1-14 / T2-5: FSRS loop — record an access event for a note.
  // The optional 4th arg is the FSRS grade (1 Again / 2 Hard / 3 Good / 4 Easy)
  // from the Memory-tab review buttons. When omitted (plain 'open' from opening a
  // tab), recordAccess applies the legacy weak-access stability update. With a
  // grade it branches: Again resets stability, Hard/Good/Easy raise it.
  ipcMain.handle('core:record-access', async (_e, filePath: string, _kind: 'open' | 'review', grade?: 1 | 2 | 3 | 4) => {
    if (!coreReady || !decayEngine) return;
    try {
      const safe = assertInsideVault(vp, filePath);
      const documentId = docIdForFile(vp, safe);
      await decayEngine.recordAccess({
        documentId,
        type: 'view',
        timestamp: new Date().toISOString(),
        ...(grade ? { grade } : {}),
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
        // T3-2: if an API key is configured, hand askVault an LLM synthesizer so it
        // returns a real synthesized + cited answer; otherwise null → askVault uses
        // its extractive search-list fallback (and the synthesizer itself falls back
        // internally on any LLM error, so a bad key never breaks Ask).
        const synthesizer = makeSynthesizer(getAiConfig()) ?? undefined;
        const res = await (core as any).askVault(searchEngine, question, { limit: 8, synthesizer });
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

  // ─── SP1 multiturn chat (multimedia-chat-sp1-plan §3, §4) ────────────────────
  // Streaming chat: the renderer invokes 'chat:send' with the turn history; tokens
  // stream back via the targeted 'chat:chunk'/'chat:done'/'chat:error' EVENTS
  // (e.sender, never broadcast). The API key is read in main (getAiConfig) and NEVER
  // crosses to the renderer or a log. chat-engine calls the provider directly — RAG is
  // injected here via the module-level searchEngine (may be null on an unindexed vault,
  // in which case the engine degrades to no grounding).
  ipcMain.handle('chat:send', async (e, req: any): Promise<void> => {
    const wcId = e.sender.id;
    const v = validateChatReq(req);
    if (!v.ok) throw new Error(`chat: ${v.msg}`);
    // Concurrency = hard-reject-at-2 (queue DEFERRED, §4). Count this sender's
    // in-flight streams; the cap lives ONLY here (single source of truth).
    let owned = 0;
    for (const ent of chatStreamRegistry.values()) if (ent.wcId === wcId) owned++;
    if (owned >= MAX_CONCURRENT) throw new Error('chat: concurrent stream cap reached');

    const cfg = getAiConfig();
    const safeSend = (ch: string, payload: unknown): void => {
      if (!e.sender.isDestroyed()) e.sender.send(ch, payload);
    };
    // 'openai-compatible' (Ollama/LM Studio) may legitimately have no key. Every other
    // provider requires one — surface a categorised error instead of a stuck bubble.
    if (!cfg || (!cfg.apiKey && cfg.provider !== 'openai-compatible')) {
      safeSend('chat:error', { streamId: req.streamId, message: 'No AI provider configured', category: 'key-missing' });
      return;
    }

    const controller = new AbortController();
    const entry: ChatStreamEntry = { controller, wcId };
    // Register BEFORE any await so an in-flight RAG search is cancellable via
    // chat:abort / before-quit.
    chatStreamRegistry.set(req.streamId, entry);

    // ─── Agent wiring (SP-D, Design Ref §5.3) ───
    // When the renderer asks for agent mode, inject the in-process toolset + executeTool
    // built from THIS process's vault singletons + a write-confirm broker. chat-engine
    // only takes the agent branch when the provider is local-ollama-with-tools (it
    // re-checks), so these are harmless to pass for a non-agent/non-local request.
    let agentOpts: Record<string, unknown> = {};
    if (req.agentOn) {
      const afterWrite = async (saved: string) => {
        const safe = assertInsideVault(currentVaultPath, saved); // re-assert (defence in depth)
        noteSelfWrite(safe); // W1-15 echo guard
        const core = await import('@stellavault/core');
        if (typeof (core as any).indexFiles === 'function') {
          await (core as any).indexFiles(currentVaultPath, [safe], { store, embedder, chunkOptions: coreChunkOptions });
        }
        bumpVaultFsVersion();
        bumpGraphCacheVersion();
      };
      const executeTool = buildExecuteAgentTool({
        searchEngine, store, decayEngine, vaultPath: currentVaultPath,
        coreReady: () => coreReady, afterWrite,
      });
      agentOpts = {
        agentOn: true,
        toolset: buildAgentToolset(),
        executeTool,
        onToolCall: (name: string, detailRedacted: string) =>
          safeSend('chat:tool-call', { streamId: req.streamId, name, detailRedacted }),
        onToolResult: (name: string, ok: boolean, summary: string) =>
          safeSend('chat:tool-result', { streamId: req.streamId, name, ok, summary }),
      };
      // Writes AUTO-APPLY by default (frictionless second-brain growth; every write is shown
      // in the tool strip, stays inside the vault, and is undoable). Opt-in "review-before-
      // apply": when req.confirmWrites is set, wire the human-approval broker so a write pauses
      // the loop on a per-stream promise the renderer resolves via chat:tool-approve. An abort
      // while waiting resolves DENY (no cap-of-2 slot leak).
      if (req.confirmWrites) {
        agentOpts.onToolConfirm = (name: string, args: Record<string, unknown>) =>
          new Promise<boolean>((resolve) => {
            if (controller.signal.aborted) { resolve(false); return; }
            const onAbort = () => { pendingApprovals.delete(req.streamId); resolve(false); };
            controller.signal.addEventListener('abort', onAbort, { once: true });
            pendingApprovals.set(req.streamId, {
              wcId,
              resolve: (val: boolean) => { controller.signal.removeEventListener('abort', onAbort); resolve(val); },
            });
            let argsPreview = '';
            try { argsPreview = JSON.stringify(args).slice(0, 400); } catch { argsPreview = '{…}'; }
            safeSend('chat:tool-confirm', { streamId: req.streamId, name, argsPreview });
          });
      }
    }

    try {
      await chatStream({
        cfg,
        messages: v.clean,
        ragOn: !!req.ragOn,
        signal: controller.signal,
        searchEngine, // module-level; may be null → engine null-guards
        ...agentOpts,
        onDelta: (d: string) => safeSend('chat:chunk', { streamId: req.streamId, delta: d }),
        onDone: (citations, fullText: string) => {
          safeSend('chat:done', { streamId: req.streamId, citations });
          const assistant: ChatMessage = {
            id: randomUUID(),
            role: 'assistant',
            text: fullText,
            ts: Date.now(),
            citations,
          };
          // Persist the full turn (user turns + the new assistant turn). The store
          // debounces, redacts, and strips citation snippet bodies at rest.
          chatSaveSession(req.sessionId, [...v.clean, assistant]);
        },
        onError: (message: string, category?: ErrorCategory) =>
          safeSend('chat:error', { streamId: req.streamId, message, category: category ?? 'generic' }),
      });
    } catch (err) {
      // Generic message to the renderer; details stay console-only (and redacted by
      // chat-engine's own logging — never the key).
      console.error('[main] chat:send stream failed:', err);
      safeSend('chat:error', { streamId: req.streamId, message: 'chat stream failed', category: 'generic' });
    } finally {
      // Identity guard: only delete if this exact entry still owns the slot (a reused
      // streamId from a later send must not be clobbered).
      if (chatStreamRegistry.get(req.streamId) === entry) chatStreamRegistry.delete(req.streamId);
      // Backstop: a still-pending write approval for this stream resolves DENY (no leak).
      const pa = pendingApprovals.get(req.streamId);
      if (pa) { pendingApprovals.delete(req.streamId); pa.resolve(false); }
    }
  });

  // Agent (SP-D): the renderer approves/denies a pending write tool. Owner-checked by
  // wcId so another window can't approve someone else's write. The renderer can ONLY
  // approve/deny — it never names a tool or its args (the model + main decide that).
  ipcMain.handle('chat:tool-approve', (e, payload: { streamId?: string; approve?: boolean }): void => {
    const sid = typeof payload?.streamId === 'string' ? payload.streamId : '';
    const pa = pendingApprovals.get(sid);
    if (!pa) return; // unknown / already-resolved
    if (pa.wcId !== e.sender.id) return; // not the owning window
    pendingApprovals.delete(sid);
    pa.resolve(payload?.approve === true);
  });

  // Karpathy auto-distillation (SP-I): after a chat turn, the renderer (when auto-distill is
  // on) sends the just-finished conversation here. We run the SAME agent loop but with the
  // INGEST system prompt — the agent folds the conversation's durable knowledge into the
  // wiki (atomic notes, [[links]], log). Writes auto-apply; no chat bubble is produced (the
  // distillation prose is discarded — only the tool activity + a short summary surface).
  ipcMain.handle('chat:distill', async (e, req: { messages: ChatMessage[]; streamId: string; sessionId?: string }): Promise<void> => {
    const wcId = e.sender.id;
    if (!Array.isArray(req?.messages) || req.messages.length === 0) return;
    if (typeof req.streamId !== 'string' || !req.streamId) return;
    const cfg = getAiConfig();
    const safeSend = (ch: string, payload: unknown): void => { if (!e.sender.isDestroyed()) e.sender.send(ch, payload); };
    // Distillation needs a local tools-capable ollama; chatStream re-checks and no-ops otherwise.
    if (!cfg || cfg.provider !== 'openai-compatible') { safeSend('chat:distill-done', { streamId: req.streamId, summary: '' }); return; }

    const transcript = req.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
      .join('\n\n')
      .slice(0, 12_000);
    const ingestTurn: ChatMessage = { id: randomUUID(), role: 'user', text: `Ingest the following finished conversation into the wiki:\n\n${transcript}`, ts: Date.now() };

    const controller = new AbortController();
    const entry: ChatStreamEntry = { controller, wcId };
    chatStreamRegistry.set(req.streamId, entry);

    const afterWrite = async (saved: string) => {
      const safe = assertInsideVault(currentVaultPath, saved);
      noteSelfWrite(safe);
      const core = await import('@stellavault/core');
      if (typeof (core as any).indexFiles === 'function') {
        await (core as any).indexFiles(currentVaultPath, [safe], { store, embedder, chunkOptions: coreChunkOptions });
      }
      bumpVaultFsVersion();
      bumpGraphCacheVersion();
    };
    const executeTool = buildExecuteAgentTool({
      searchEngine, store, decayEngine, vaultPath: currentVaultPath, coreReady: () => coreReady, afterWrite,
    });

    try {
      await chatStream({
        cfg,
        messages: [ingestTurn],
        ragOn: false,            // distillation does its own search; no RAG pre-injection
        signal: controller.signal,
        searchEngine,
        agentOn: true,
        distill: true,           // → agent loop uses the Karpathy INGEST prompt
        toolset: buildAgentToolset(),
        executeTool,             // writes auto-apply (no onToolConfirm)
        onToolCall: (name, detailRedacted) => safeSend('chat:tool-call', { streamId: req.streamId, name, detailRedacted }),
        onToolResult: (name, ok, summary) => safeSend('chat:tool-result', { streamId: req.streamId, name, ok, summary }),
        onDelta: () => { /* distillation prose is not shown as a chat bubble */ },
        onDone: (_citations, fullText) => safeSend('chat:distill-done', { streamId: req.streamId, summary: fullText.slice(0, 300) }),
        onError: () => safeSend('chat:distill-done', { streamId: req.streamId, summary: '' }),
      });
    } catch (err) {
      console.error('[main] chat:distill failed:', err);
      safeSend('chat:distill-done', { streamId: req.streamId, summary: '' });
    } finally {
      if (chatStreamRegistry.get(req.streamId) === entry) chatStreamRegistry.delete(req.streamId);
    }
  });

  // Abort an in-flight stream. Only the OWNING webContents may abort its own stream.
  ipcMain.handle('chat:abort', (e, streamId: string): void => {
    const entry = chatStreamRegistry.get(streamId);
    if (!entry) return;
    if (entry.wcId !== e.sender.id) return; // not your stream
    entry.controller.abort();
    chatStreamRegistry.delete(streamId);
  });

  // Session CRUD (⑨) — delegate to the store. Filenames are UUIDs; the store's
  // isUuid + assertInsideDir guards run on every op. rename writes a title FIELD.
  ipcMain.handle('chat:list-sessions', () => chatListSessions());
  ipcMain.handle('chat:load-session', (_e, id: string) => chatLoadSession(id));
  ipcMain.handle('chat:rename-session', (_e, id: string, title: string) => chatRenameSession(id, title));
  ipcMain.handle('chat:delete-session', (_e, id: string) => chatDeleteSession(id));

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

  // ─── [T2-6 Coach panel — appended block] ─────────────
  // Surfaces the dormant differentiators (zero IPC hits before this): cluster
  // knowledge gaps + isolated notes (detectKnowledgeGaps), topology-predicted
  // topics (predictKnowledgeGaps), and a fused review/learn next list
  // (generateLearningPath over the decay report + gaps). Mirrors the engine
  // calls core's mcp/server.ts wires for the MCP tools, called directly here.
  // Each handler degrades to an empty payload when the vault is unindexed or an
  // older core lacks the function — the panel renders a friendly empty state.

  /** docId → { absolute filePath, title } via the documents table (same lookup
   *  getDecayItems uses). '' filePath when the doc isn't in the index. */
  const resolveDocFile = (documentId: string): { filePath: string; title: string } => {
    try {
      const db = store?.getDb?.();
      const row = db?.prepare('SELECT file_path, title FROM documents WHERE id = ?').get(documentId) as
        { file_path?: string; title?: string } | undefined;
      return {
        filePath: row?.file_path ? join(vp, row.file_path) : '',
        title: row?.title ?? '',
      };
    } catch {
      return { filePath: '', title: '' };
    }
  };

  ipcMain.handle('core:gaps', async (): Promise<CoachGaps> => {
    const empty: CoachGaps = { totalClusters: 0, totalGaps: 0, gaps: [], isolated: [], predicted: [] };
    if (!coreReady || !store) return empty;
    try {
      const core = await import('@stellavault/core');
      // Build the graph once and feed it to detectKnowledgeGaps (avoids a second
      // internal buildGraphData) — same data the graph panel already caches.
      let graphData: any;
      try {
        graphData = typeof (core as any).buildGraphData === 'function'
          ? await (core as any).buildGraphData(store, { mode: 'semantic' })
          : undefined;
      } catch { graphData = undefined; }

      const report = typeof (core as any).detectKnowledgeGaps === 'function'
        ? await (core as any).detectKnowledgeGaps(store, graphData)
        : { totalClusters: 0, totalGaps: 0, gaps: [], isolatedNodes: [] };

      let predicted: CoachGaps['predicted'] = [];
      try {
        if (typeof (core as any).predictKnowledgeGaps === 'function') {
          const preds = await (core as any).predictKnowledgeGaps(store, 8);
          predicted = (preds ?? []).map((p: any) => ({
            topic: p.topic ?? '',
            reason: p.reason ?? '',
            confidence: typeof p.confidence === 'number' ? p.confidence : 0,
            category: p.category ?? 'adjacent',
          }));
        }
      } catch (err) {
        console.error('[main] predictKnowledgeGaps failed:', err);
      }

      return {
        totalClusters: report?.totalClusters ?? 0,
        totalGaps: report?.totalGaps ?? 0,
        gaps: (report?.gaps ?? []).map((g: any) => ({
          clusterA: g.clusterA ?? '',
          clusterB: g.clusterB ?? '',
          bridgeCount: g.bridgeCount ?? 0,
          suggestedTopic: g.suggestedTopic ?? '',
          severity: g.severity ?? 'low',
        })),
        isolated: (report?.isolatedNodes ?? []).map((n: any) => {
          const f = resolveDocFile(n.id);
          return {
            documentId: n.id ?? '',
            title: n.title || f.title || 'Untitled',
            connections: n.connections ?? 0,
            filePath: f.filePath,
          };
        }),
        predicted,
      };
    } catch (err) {
      console.error('[main] core:gaps failed:', err);
      return empty;
    }
  });

  ipcMain.handle('core:learning-path', async (_e, limit?: number): Promise<CoachLearningPath> => {
    const empty: CoachLearningPath = {
      items: [],
      summary: { reviewCount: 0, exploreCount: 0, bridgeCount: 0, estimatedMinutes: 0 },
    };
    if (!coreReady || !store || !decayEngine) return empty;
    try {
      const core = await import('@stellavault/core');
      if (typeof (core as any).generateLearningPath !== 'function') return empty;

      // The decay report is the spine of the path (review queue); gaps add bridge
      // suggestions. computeAll() returns the same DecayReport the engine builds.
      const decayReport = await decayEngine.computeAll();

      let gaps: any[] = [];
      try {
        if (typeof (core as any).detectKnowledgeGaps === 'function') {
          const graphData = typeof (core as any).buildGraphData === 'function'
            ? await (core as any).buildGraphData(store, { mode: 'semantic' })
            : undefined;
          const report = await (core as any).detectKnowledgeGaps(store, graphData);
          gaps = (report?.gaps ?? []).map((g: any) => ({
            clusterA: g.clusterA, clusterB: g.clusterB,
            severity: g.severity, suggestedTopic: g.suggestedTopic,
          }));
        }
      } catch { /* gaps optional — review-only path still useful */ }

      const path = (core as any).generateLearningPath({ decayReport, gaps }, limit ?? 15);
      return {
        items: (path?.items ?? []).map((it: any) => {
          const f = it.documentId ? resolveDocFile(it.documentId) : { filePath: '', title: '' };
          return {
            documentId: it.documentId ?? '',
            title: it.title || f.title || 'Untitled',
            reason: it.reason ?? '',
            priority: it.priority ?? 'suggested',
            score: it.score ?? 0,
            category: it.category ?? 'review',
            filePath: f.filePath,
          };
        }),
        summary: {
          reviewCount: path?.summary?.reviewCount ?? 0,
          exploreCount: path?.summary?.exploreCount ?? 0,
          bridgeCount: path?.summary?.bridgeCount ?? 0,
          estimatedMinutes: path?.summary?.estimatedMinutes ?? 0,
        },
      };
    } catch (err) {
      console.error('[main] core:learning-path failed:', err);
      return empty;
    }
  });
  // ─── [end T2-6 Coach panel block] ────────────────────

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
  //
  // T2-7: GraphView (main pane) and GraphPanel (right panel) each fire
  // 'graph:build' independently → the build ran TWICE per graph open, freezing
  // the window each time. Cache the result per (mode, index version); the second
  // caller (and every reopen until the next edit) gets the cached build. An
  // in-flight Map coalesces the two near-simultaneous mount calls so the build
  // executes once even before it resolves. Invalidated by bumpGraphCacheVersion()
  // on reindex / file:changed (see core:index + startVaultWatcher below).
  ipcMain.handle('graph:build', async (_e, mode: string) => {
    if (!coreReady || !store) return { nodes: [], edges: [] };
    const safeMode: 'semantic' | 'folder' = mode === 'folder' ? 'folder' : 'semantic';
    const cacheKey = `${safeMode}@${graphCacheVersion}`;
    const cached = graphBuildCache.get(cacheKey);
    if (cached) return cached;
    const inflight = graphBuildInflight.get(cacheKey);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        const core = await import('@stellavault/core');
        const data = await core.buildGraphData(store, { mode: safeMode });
        graphBuildCache.set(cacheKey, data);
        return data;
      } catch (err) {
        console.error('[main] Graph build failed:', err);
        return { nodes: [], edges: [] };
      } finally {
        graphBuildInflight.delete(cacheKey);
      }
    })();
    graphBuildInflight.set(cacheKey, p);
    return p;
  });

  // ─── Wave 1 cluster-first LOD (docs/02-design/graph-scale-lod-redesign.md) ───
  // graph:clusters → ≤~80 cluster super-nodes for the first paint (tiny payload).
  // graph:expand-cluster → one cluster's members (a Map lookup after the first build).
  // Both read from a per-(mode, version) cached ClusteredGraph, in-flight coalesced.
  const getClustered = async (safeMode: 'semantic' | 'folder'): Promise<ClusteredGraph | null> => {
    const key = `clustered:${safeMode}@${graphCacheVersion}`;
    const cached = clusteredCache.get(key);
    if (cached) return cached;
    const inflight = clusteredInflight.get(key);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        const core = await import('@stellavault/core');
        const g = await core.buildClusteredGraph(store!, { mode: safeMode });
        clusteredCache.set(key, g);
        return g;
      } catch (err) {
        console.error('[main] clustered graph build failed:', err);
        return null;
      } finally {
        clusteredInflight.delete(key);
      }
    })();
    clusteredInflight.set(key, p);
    return p;
  };
  const emptyGalaxy = { level: 'galaxy' as const, superNodes: [], metaEdges: [], totalNodes: 0, totalEdges: 0, layoutVersion: '' };

  ipcMain.handle('graph:clusters', async (_e, opts?: { mode?: string }) => {
    if (!coreReady || !store) return emptyGalaxy;
    const safeMode: 'semantic' | 'folder' = opts?.mode === 'folder' ? 'folder' : 'semantic';
    const g = await getClustered(safeMode);
    return g ? g.clusterLevel : emptyGalaxy;
  });

  ipcMain.handle('graph:expand-cluster', async (_e, opts: { mode?: string; clusterId: number }) => {
    const clusterId = opts?.clusterId ?? 0;
    const empty = { clusterId, members: [], intraEdges: [], boundaryEdges: [] };
    if (!coreReady || !store) return empty;
    const safeMode: 'semantic' | 'folder' = opts?.mode === 'folder' ? 'folder' : 'semantic';
    const g = await getClustered(safeMode);
    return g?.members.get(clusterId) ?? empty;
  });

  // Startup race guard: the renderer queries this on mount in case it registered its
  // 'core:ready' listener AFTER the (now-fast) init already fired the event.
  ipcMain.handle('core:get-ready', () => coreReady);

  // Backlinks — find notes that contain [[title]]
  // T2-8: async (fs.promises, bounded concurrency) + cached per FS version so a
  // note-open scans the vault once, then later opens in the same version are Map
  // hits. Invalidated by bumpVaultFsVersion() on any vault mutation. See block above.
  ipcMain.handle('backlinks:find', (_e, title: string) => findBacklinks(vp, title));

  // Settings (W1-1) — get/set + broadcast to all windows on change
  ipcMain.handle('settings:get', () => {
    if (!settingsStore) settingsStore = new SettingsStore();
    // T3: Never return raw settings to the renderer — strip apiKey and replace
    // with hasKey/keychainAvailable indicators (see redact-secrets.ts).
    return redactSecrets(
      settingsStore.get(),
      (p) => !!secretStore?.hasSecret(p),
      secretStore?.isPersistent() ?? false,
    );
  });
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    if (!settingsStore) settingsStore = new SettingsStore();
    const rawPatch = patch ?? {};

    // T3: Strip ai.apiKey from any incoming patch — keys are set-only via
    // 'secret:set-key'. Silently drop so a rogue/buggy renderer can't write
    // a key back into the plaintext settings file.
    if (rawPatch.ai && typeof rawPatch.ai === 'object') {
      // ai-namespace hardening: only accept known safe fields (provider/model/baseURL).
      // This also blocks null-deletion of ai fields via deepMerge's null=delete
      // sentinel (a renderer sending { ai: { provider: null } } would wipe the
      // provider from the stored object — self-DoS, not a key leak, but unwanted).
      const { provider, model, baseURL } = rawPatch.ai as Record<string, unknown>;
      const safeAi: Record<string, unknown> = {};
      // Only propagate known scalar fields; silently ignore null/unknown keys.
      if (provider !== undefined && provider !== null) safeAi.provider = provider;
      if (model !== undefined && model !== null) safeAi.model = model;
      if (baseURL !== undefined && baseURL !== null) safeAi.baseURL = baseURL;
      (rawPatch as Record<string, unknown>).ai = safeAi;
    }

    // T1-13: drop invalid fields (negative window size, bad theme/accent) before
    // they persist + re-apply. Pure, unit-tested in tests/settings-validate.test.ts.
    const merged = settingsStore.set(validateSettingsPatch(rawPatch));
    broadcastSettingsChanged(merged);
    // Return redacted settings to the renderer (same contract as settings:get).
    return redactSecrets(
      merged,
      (p) => !!secretStore?.hasSecret(p),
      secretStore?.isPersistent() ?? false,
    );
  });

  // AI model dropdown — fetch a provider's available models (main-side: the renderer
  // can't hit the provider cross-origin under CSP).
  // T5 security fix: the API key is loaded from secretStore here in the main process.
  // The renderer ONLY passes provider + optional baseURL — it can no longer supply an
  // arbitrary key (closes the SSRF-adjacent gap where a compromised renderer could
  // trigger outbound HTTP requests with any key it crafted).
  ipcMain.handle('ai:list-models', async (_e, opts: { provider: string; baseURL?: string }) => {
    // I-1: reject arbitrary/unknown provider strings from the renderer.
    if (!isValidProvider(opts.provider)) {
      throw new Error(`Unknown provider: ${opts.provider}`);
    }
    // Load the stored key for this provider (undefined → no key saved yet).
    const storedKey = secretStore?.getSecret(opts.provider) ?? '';
    const req = modelsListRequest(opts.provider as AiProvider, storedKey, opts.baseURL ?? '');
    if (!req) {
      // Provider needs a key but none is stored yet — friendly error the UI surfaces.
      const needsKey = ['anthropic', 'openai', 'google'].includes(opts.provider);
      if (needsKey && !storedKey) throw new Error('No API key saved. Save a key first, then click Load.');
      // No listing endpoint for this provider (e.g. 'none') or baseURL missing.
      return [];
    }
    const res = await net.fetch(req.url, { headers: req.headers });
    if (!res.ok) throw new Error(`Model list failed (${res.status})`);
    return parseModelsResponse(opts.provider as AiProvider, await res.json());
  });

  // T4: Write-only key IPC (Design §6.3 / CRIT-03).
  // The renderer can store, check, or clear a provider API key, but NEVER read it
  // back — there is intentionally no ai:get-secret / ai:read-secret handler.
  // I-1: validate provider against the known AiProvider whitelist.
  // I-2: ai:set-secret throws when secretStore is null so the renderer can surface
  //       the failure instead of silently believing the save succeeded.
  ipcMain.handle('ai:set-secret', (_e, provider: string, key: string): void => {
    if (!isValidProvider(provider)) return; // I-1: unknown provider → no-op
    if (!secretStore) throw new Error('Secret store unavailable — key not saved'); // I-2
    secretStore.setSecret(provider, key);
  });
  ipcMain.handle('ai:has-secret', (_e, provider: string): boolean => {
    if (!isValidProvider(provider)) return false; // I-1: unknown provider → false
    return secretStore?.hasSecret(provider) ?? false;
  });

  // ─── Local model server (Ollama) lifecycle ───
  // "Start Ollama" UX: the renderer can ask whether the local server is up/installed
  // and request a start. ollama:start spawns a FIXED binary (ollama-manager resolves it
  // from PATH / known install dirs) — the renderer NEVER supplies a path or args; the
  // optional baseURL is used only for the HTTP reachability probe.
  ipcMain.handle('ollama:status', (_e, opts?: { baseURL?: string }) =>
    ollamaStatus(opts?.baseURL ?? ''),
  );
  ipcMain.handle('ollama:start', (_e, opts?: { baseURL?: string }) =>
    startOllama(opts?.baseURL ?? ''),
  );
  // Compat check + auto-download (button-prompt). Like ollama:start, the renderer supplies
  // NOTHING to these — the version is read from the resolved binary, and the download is a
  // FIXED GitHub release + FIXED per-platform asset (see ollama-manager security note).
  ipcMain.handle('ollama:version', async () => ({ version: await getOllamaVersion() }));
  ipcMain.handle('ollama:compat', () => checkCompat());
  ipcMain.handle('ollama:download', (e) =>
    // Stream download progress to the requesting renderer only (e.sender, never broadcast).
    downloadAndInstallOllama((p) => {
      if (!e.sender.isDestroyed()) e.sender.send('ollama:download-progress', p);
    }),
  );
  ipcMain.handle('ai:clear-secret', (_e, provider: string): void => {
    if (!isValidProvider(provider)) return; // I-1: unknown provider → no-op
    secretStore?.clearSecret(provider);
  });

  // Window controls
  ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.handle('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
  });
  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

  // ─── [file-tree/close agent owned block — T2-18 dirty-close round-trip] ───
  // window:close-dialog — main shows the native Save/Discard/Cancel box and
  // returns the user's choice. Called by the renderer only when dirty tabs exist
  // (see session-persist.ts close guard). Kept in main because dialog.showMessageBox
  // is a main-process API and we want a real OS-modal dialog (Chromium suppresses
  // the renderer beforeunload prompt under Electron).
  ipcMain.handle('window:close-dialog', async (e): Promise<'save' | 'discard' | 'cancel'> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      type: 'warning' as const,
      buttons: ['Save all', 'Discard', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: 'Unsaved changes',
      message: 'You have unsaved changes.',
      detail: 'Save all notes before closing, discard them, or cancel and keep working.',
    };
    // Window-modal when we can resolve the sender's window; falls back to app-modal.
    const { response } = win
      ? await dialog.showMessageBox(win, opts)
      : await dialog.showMessageBox(opts);
    return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel';
  });

  // window:confirm-close — renderer's verdict for the pending close. proceed=true
  // destroys the window (bypassing the guard); false aborts and keeps running.
  ipcMain.handle('window:confirm-close', (e, proceed: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (!proceed) {
      // Close vetoed (Cancel / save failed). Abandon any deferred vault switch so a
      // later ordinary close never silently applies it; the 'close' handler already
      // preventDefaulted, so the session stays on the current vault.
      pendingVaultSwitch = null;
      return;
    }
    // Commit a deferred vault switch now that close is confirmed (dirty tabs were
    // handled by the renderer guard). This rewrites the bootstrap pointer ONLY here,
    // never on a vetoed close — fixing the write-then-veto inconsistency.
    if (pendingVaultSwitch) {
      const sw = pendingVaultSwitch;
      pendingVaultSwitch = null;
      try {
        const list = settingsStore?.get().vaults ?? [];
        settingsStore?.set({ vaults: list.map((v) => ({ ...v, active: v.id === sw.id })) });
        writeFileSync(
          join(homedir(), '.stellavault.json'),
          JSON.stringify({ vaultPath: sw.path, dbPath: sw.dbPath }, null, 2),
          'utf-8',
        );
        app.relaunch();
      } catch (err) {
        console.error('[main] vault:switch commit failed:', err);
        return; // keep the session alive on the current vault rather than close into limbo
      }
    }
    closeConfirmed.add(win);
    win.destroy(); // → window-all-closed → app.quit() (+ relaunch if one was armed)
  });

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

  // shell:open-external — https-only allowlist, PLUS loopback http for the local
  // Publish server (T3-7): http://127.0.0.1:<port> / http://localhost:<port> are
  // safe to hand to the OS browser (they only reach our own server bound to
  // 127.0.0.1). Everything else (file:, javascript:, remote http:) stays blocked.
  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('Invalid URL'); }
    const isLoopbackHttp = parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    if (parsed.protocol !== 'https:' && !isLoopbackHttp) {
      throw new Error('Only https:// or loopback http:// URLs are allowed');
    }
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

  // ─── [auto-update agent owned block — T3-12] ───
  // app:get-version returns the running app version (About box / update UI).
  ipcMain.handle('app:get-version', (): string => app.getVersion());
  // update:check triggers a manual check. The autoUpdater is configured in
  // setupAutoUpdate() (called from whenReady); here we delegate to its
  // checkForUpdatesNow() and return a human status string. Progress/result is
  // also pushed asynchronously via the 'update:status' broadcast event.
  ipcMain.handle('update:check', (): string => checkForUpdatesNow());
  // ─── [end auto-update agent block] ───

  // ─── [publish/multi-vault agent owned block — T3-7 / T3-9 / T3-4] ───────
  // Three appended, self-contained feature slices. They reuse the existing
  // `vp`/`config`/`store`/`embedder`/`settingsStore` closures above; nothing in
  // the blocks above is modified. See registerPublishVaultClip for the impl.
  registerPublishVaultClip(config);
  registerCaptureHandlers();
  // ─── [end publish/multi-vault agent block] ─────────────────────────────

  // ─── [AI-synthesis agent owned block — T3-1 / T3-8 appended] ───────────
  // T3-1 Wiki Synthesis: compile a cited article on a topic from the vault.
  // Search → gather sources → synthesize. With an API key configured, the LLM
  // synthesizer writes a real article citing [[Note]] backlinks; without one it
  // degrades to an extractive outline (still cited) so the panel always works.
  ipcMain.handle('core:synthesize', async (_e, topic: string): Promise<SynthesisResult> => {
    const t = (topic ?? '').trim();
    const empty: SynthesisResult = { topic: t, article: '', synthesized: false, sources: [] };
    if (!coreReady || !searchEngine || !t) return empty;
    try {
      const results = await searchEngine.search({ query: t, limit: 10 });
      const sources: SynthesisResult['sources'] = results.map((r: any) => {
        const m = mapCoreSearchResult(vp, r);
        return { title: m.title, filePath: m.filePath, snippet: m.snippet };
      });
      if (sources.length === 0) {
        return { topic: t, synthesized: false, sources: [], article:
          `# ${t}\n\nNo notes in your vault cover **${t}** yet. Capture a few notes on it, then synthesize again.` };
      }

      // LLM path. core's SynthesisSource uses title + snippet for grounding.
      const synthesizer = makeSynthesizer(getAiConfig());
      if (synthesizer) {
        try {
          const article = await synthesizer.synthesize({
            question: t,
            mode: 'wiki',
            sources: sources.map((s) => ({ title: s.title, filePath: s.filePath, snippet: s.snippet, score: 0 })),
          });
          return { topic: t, article, synthesized: true, sources };
        } catch (err) {
          console.error('[main] core:synthesize LLM failed — extractive fallback:', err);
        }
      }

      // Extractive fallback: structured outline citing each source as [[Title]].
      const lines: string[] = [`# ${t}`, ''];
      lines.push(`*Compiled from ${sources.length} of your notes. Add an AI provider key in Settings for a synthesized article.*`, '');
      lines.push('## Key points', '');
      for (const s of sources.slice(0, 8)) {
        const snip = (s.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
        lines.push(`- [[${s.title}]]${snip ? ` — ${snip}…` : ''}`);
      }
      lines.push('', '## Related notes', '');
      for (const s of sources) lines.push(`- [[${s.title}]]`);
      return { topic: t, article: lines.join('\n'), synthesized: false, sources };
    } catch (err) {
      console.error('[main] core:synthesize failed:', err);
      return empty;
    }
  });

  // T3-8: contradiction nudges — wire core.detectContradictions. Statements +
  // absolute filePaths so the Coach panel can open either side of the pair.
  ipcMain.handle('core:contradictions', async (_e, limit?: number): Promise<ContradictionNudge[]> => {
    if (!coreReady || !store) return [];
    try {
      const core = await import('@stellavault/core');
      if (typeof (core as any).detectContradictions !== 'function') return [];
      const pairs = await (core as any).detectContradictions(store, limit ?? 10);
      return (pairs ?? []).map((p: any) => ({
        docA: { title: p.docA?.title ?? 'Untitled', filePath: p.docA?.filePath ? join(vp, p.docA.filePath) : '', statement: p.docA?.statement ?? '' },
        docB: { title: p.docB?.title ?? 'Untitled', filePath: p.docB?.filePath ? join(vp, p.docB.filePath) : '', statement: p.docB?.statement ?? '' },
        similarity: typeof p.similarity === 'number' ? p.similarity : 0,
        confidence: typeof p.confidence === 'number' ? p.confidence : 0,
        type: p.type ?? 'semantic',
      }));
    } catch (err) {
      console.error('[main] core:contradictions failed:', err);
      return [];
    }
  });

  // T3-8: duplicate nudges — wire core.detectDuplicates (vector cosine ≥ 0.88).
  ipcMain.handle('core:duplicates', async (_e, limit?: number): Promise<DuplicateNudge[]> => {
    if (!coreReady || !store) return [];
    try {
      const core = await import('@stellavault/core');
      if (typeof (core as any).detectDuplicates !== 'function') return [];
      const pairs = await (core as any).detectDuplicates(store, 0.88, limit ?? 10);
      return (pairs ?? []).map((p: any) => ({
        docA: { title: p.docA?.title ?? 'Untitled', filePath: p.docA?.filePath ? join(vp, p.docA.filePath) : '' },
        docB: { title: p.docB?.title ?? 'Untitled', filePath: p.docB?.filePath ? join(vp, p.docB.filePath) : '' },
        similarity: typeof p.similarity === 'number' ? p.similarity : 0,
      }));
    } catch (err) {
      console.error('[main] core:duplicates failed:', err);
      return [];
    }
  });
  // ─── [end AI-synthesis agent block] ────────────────────────────────────

  // ─── [capture/automation agent owned block — T3-5 / T3-6 / T3-3 appended] ─
  // T3-5 decision journal / ADR capture, T3-6 auto-linker, T3-3 Agent Memory MCP
  // toggle. All reuse the `vp`/`store`/`searchEngine` closures above; nothing
  // above is modified. Decision files live under <vault>/decisions/ (core handles
  // path-traversal guarding via assertInsideVault-equivalent in decision-journal).

  // T3-5: log a structured decision (ADR) → <vault>/decisions/<date>-<slug>.md.
  ipcMain.handle('decision:log', async (_e, input: DecisionInput): Promise<{ filePath: string; fileName: string }> => {
    if (!input || typeof input.title !== 'string' || typeof input.decision !== 'string' || typeof input.reasoning !== 'string') {
      throw new Error('decision:log: title, decision, and reasoning are required');
    }
    const core = await import('@stellavault/core');
    const res = await (core as any).handleLogDecision(vp, {
      title: input.title,
      context: input.context,
      decision: input.decision,
      alternatives: Array.isArray(input.alternatives) ? input.alternatives : undefined,
      reasoning: input.reasoning,
      project: input.project,
    });
    // core returns an absolute path in `saved`; assert it stayed inside the vault
    // (defense-in-depth — core already guards, but the IPC boundary re-verifies).
    const filePath = res?.saved ?? '';
    if (filePath) assertInsideVault(vp, filePath);
    noteSelfWrite(filePath); // W1-15 echo guard — our own write
    bumpVaultFsVersion();
    return { filePath, fileName: res?.fileName ?? '' };
  });

  // T3-5: list past decisions (newest first). Empty query → list all (capped).
  ipcMain.handle('decision:list', async (_e, query?: string): Promise<DecisionEntry[]> => {
    const decisionsDir = join(vp, 'decisions');
    if (!existsSync(decisionsDir)) return [];
    const core = await import('@stellavault/core');
    // core.handleFindDecisions requires a query; for the unfiltered list we read
    // the directory directly (same shape) so the view shows everything by default.
    let files: { file: string; content: string }[];
    const q = (query ?? '').trim();
    if (q) {
      const found = await (core as any).handleFindDecisions(vp, { query: q });
      files = (found?.decisions ?? []).map((d: any) => ({ file: d.file, content: d.content ?? '' }));
    } else {
      const names = readdirSync(decisionsDir).filter((f) => f.endsWith('.md')).sort().reverse();
      files = names.map((f) => {
        let content = '';
        try { content = readFileSync(join(decisionsDir, f), 'utf-8'); } catch { /* unreadable — skip body */ }
        return { file: f, content };
      });
    }
    return files.map((f): DecisionEntry => {
      const titleMatch = f.content.match(/^title:\s*"?([^"\n]+)"?\s*$/m);
      const dateMatch = f.content.match(/^date:\s*([0-9-]+)\s*$/m);
      const projMatch = f.content.match(/^project:\s*"?([^"\n]*)"?\s*$/m);
      const dateFromName = f.file.match(/^(\d{4}-\d{2}-\d{2})/);
      return {
        fileName: f.file,
        filePath: join(decisionsDir, f.file),
        title: titleMatch?.[1]?.trim() || f.file.replace(/\.md$/, ''),
        date: (dateMatch?.[1] || dateFromName?.[1] || '').trim(),
        project: projMatch?.[1]?.trim() ?? '',
        snippet: f.content.slice(0, 300),
      };
    });
  });

  // T3-5: knowledge-evolution timeline — which notes changed most recently.
  // Reuses the core get-evolution MCP tool (no MCP server needed) against store.
  ipcMain.handle('decision:evolution', async (_e, limit?: number): Promise<EvolutionEntry[]> => {
    if (!coreReady || !store) return [];
    try {
      const core = await import('@stellavault/core');
      if (typeof (core as any).createGetEvolutionTool !== 'function') return [];
      const tool = (core as any).createGetEvolutionTool(store);
      const out = await tool.handler({ limit: limit ?? 12 });
      const text = out?.content?.[0]?.text ?? '{}';
      const parsed = JSON.parse(text);
      const rows: any[] = parsed?.recentlyEvolved ?? [];
      return rows.map((r): EvolutionEntry => {
        const f = resolveDocFile(r.documentId);
        return {
          documentId: r.documentId ?? '',
          title: r.title || f.title || 'Untitled',
          filePath: f.filePath,
          lastModified: r.lastModified ?? '',
          daysSinceModified: typeof r.daysSinceModified === 'number' ? r.daysSinceModified : 0,
          tags: Array.isArray(r.tags) ? r.tags : [],
        };
      });
    } catch (err) {
      console.error('[main] decision:evolution failed:', err);
      return [];
    }
  });

  // T3-6: auto-linker — find vault titles mentioned as plain text in `body` and
  // return suggestions + an apply-all preview. selfTitle prevents self-linking.
  // No write happens here; the renderer applies after the user confirms.
  ipcMain.handle('autolink:suggest', async (_e, body: string, selfTitle?: string): Promise<AutoLinkResult> => {
    const src = typeof body === 'string' ? body : '';
    if (!src.trim()) return { suggestions: [], linkedBody: src };
    try {
      const core = await import('@stellavault/core');
      const titles: string[] = typeof (core as any).collectVaultTitles === 'function'
        ? (core as any).collectVaultTitles(vp)
        : [];
      if (titles.length === 0) return { suggestions: [], linkedBody: src };
      const linkedBody: string = (core as any).insertWikilinks(src, titles, selfTitle);
      // Derive the suggestion list by diffing newly-inserted [[target|phrase]]
      // tokens against the original (insertWikilinks only adds the alias form).
      const suggestions: LinkSuggestion[] = [];
      const re = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(linkedBody)) !== null) {
        const target = m[1];
        const phrase = m[2];
        // Only count links that did NOT already exist in the source as that alias.
        if (!src.includes(`[[${target}|${phrase}]]`)) {
          suggestions.push({ phrase, target });
        }
      }
      return { suggestions, linkedBody };
    } catch (err) {
      console.error('[main] autolink:suggest failed:', err);
      return { suggestions: [], linkedBody: src };
    }
  });

  // T3-3: Agent Memory — start/stop/poll the embedded MCP server (loopback only).
  ipcMain.handle('mcp:start', async (): Promise<McpStatus> => {
    await startMcpServer();
    return mcpStatus();
  });
  ipcMain.handle('mcp:stop', async (): Promise<McpStatus> => {
    await stopMcpServer();
    return mcpStatus();
  });
  ipcMain.handle('mcp:status', (): McpStatus => mcpStatus());
  // ─── [end capture/automation agent block] ──────────────────────────────
}

// ─── [publish/multi-vault agent owned block — impl] ──────────────────────
// T3-7 Publish (local read-only PWA+dashboard), T3-9 multi-vault switcher +
// cross-vault search, T3-4 web clipper endpoint. Kept in one function so the
// closures (vp/store/embedder/settingsStore) and the long-lived publish server
// handle live together. Registered from registerIpcHandlers via the marked call.

let publishServer: HttpServer | null = null;
let publishPortInUse = 0;

function getSettings(): AppSettings {
  if (!settingsStore) settingsStore = new SettingsStore();
  return settingsStore.get();
}

function publishStatus(): PublishStatus {
  const running = !!publishServer && publishServer.listening;
  return {
    running,
    url: running ? `http://127.0.0.1:${publishPortInUse}/dashboard` : '',
    port: running ? publishPortInUse : (getSettings().publishPort ?? 3105),
  };
}

/** Slugify a vault name/path into a short stable registry id. */
function vaultSlug(name: string, path: string): string {
  const base = (name || basename(path) || 'vault')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'vault';
  // Disambiguate with a short path hash so two "Notes" folders don't collide.
  const h = createHash('sha256').update(resolve(path)).digest('hex').slice(0, 6);
  return `${base}-${h}`;
}

/** Ensure the booted vault is in the registry + flagged active. Idempotent.
 *  Seeds the registry on first run (getDefaults ships an empty array). */
function ensureActiveVaultRegistered(config: AppConfig): VaultRegistryEntry[] {
  if (!settingsStore) settingsStore = new SettingsStore();
  const current = settingsStore.get().vaults ?? [];
  const activePath = resolve(config.vaultPath);
  let list = current.map((v) => ({ ...v, active: resolve(v.path) === activePath }));
  if (!list.some((v) => resolve(v.path) === activePath)) {
    list = [
      ...list,
      {
        id: vaultSlug(basename(config.vaultPath), config.vaultPath),
        name: basename(config.vaultPath) || 'Vault',
        path: config.vaultPath,
        dbPath: config.dbPath,
        active: true,
      },
    ];
  }
  settingsStore.set({ vaults: list });
  return list;
}

// ─── Second-brain auto-capture IPC (Design §6.4) ───
// All handlers reference the module-level `engine` (created at the end of initCore;
// null until core is ready → safe degraded responses). The renderer never receives
// note bodies or centroids — only the wire-safe DTOs the engine produces.
function registerCaptureHandlers(): void {
  ipcMain.handle('vault:capture', (_e, req: CaptureRequest) => {
    if (!engine) return { id: '' };
    // A file dropped in the renderer arrives as base64 (the renderer has no path).
    // Stage it to a tmp file so the engine's extractFileContent(path) reuse works,
    // then enqueue the path. The tmp file is the engine's input; the vault copy is
    // created by ingest(). (50MB cap is enforced renderer-side + in the engine.)
    if (req.kind === 'file' && req.sourceMeta?.base64) {
      try {
        const named = sanitizeAssetName(req.sourceMeta.fileName ?? 'dropped');
        const tmpPath = join(tmpdir(), `sv-cap-${Date.now()}-${Math.round(Math.random() * 1e9).toString(36)}-${named.base}${named.ext}`);
        writeFileSync(tmpPath, Buffer.from(req.sourceMeta.base64, 'base64'));
        const { base64: _omit, ...meta } = req.sourceMeta;
        return engine.enqueue({ ...req, payload: tmpPath, sourceMeta: meta });
      } catch (err) {
        console.error('[capture] file staging failed:', err);
        return { id: '' };
      }
    }
    // SECURITY (Codex P1): a file capture by PATH must NOT come through this
    // renderer-callable channel — a compromised renderer could read ANY local file
    // (bypassing assertInsideVault) by enqueuing an arbitrary absolute path. Dropped
    // files go through the preload-only 'capture:dropped-file' (path resolved by
    // webUtils.getPathForFile, which a renderer can't forge); explicit picks go
    // through dialog (capture:pick-files). Reject renderer-supplied paths here.
    if (req.kind === 'file') {
      console.warn('[capture] rejected file capture without staged bytes (path must use captureDroppedFile / pick-files)');
      return { id: '' };
    }
    return engine.enqueue(req); // url / text — payload is content/uri, not a path
  });
  // Preload-only channel (deliberately NOT in the renderer ALLOWED_CHANNELS): the
  // dropped File's real path, resolved by webUtils.getPathForFile inside preload.
  // Trusted because a renderer can't fabricate a path via getPathForFile (a memory
  // File yields ''), and generic invoke() rejects this channel. Codex P1.
  ipcMain.handle('capture:dropped-file', (_e, filePath: string, meta?: { fileName?: string; mime?: string }) => {
    if (!engine || typeof filePath !== 'string' || !filePath) return { id: '' };
    return engine.enqueue({ kind: 'file', payload: filePath, source: 'drop', sourceMeta: meta });
  });
  ipcMain.handle('capture:list', (_e, limit?: number) => (engine ? engine.listCaptures(limit) : []));
  ipcMain.handle('capture:set-paused', (_e, paused: boolean) => { engine?.setPaused(paused); });
  ipcMain.handle('capture:counts', () => (engine ? engine.counts() : { capturedToday: 0, pendingReviewCount: 0, queueDepth: 0, watching: false }));
  // Guaranteed capture path (works even if OS drag-drop delivery is flaky): native
  // file picker → enqueue the real paths directly (no base64/tmp staging needed).
  ipcMain.handle('capture:pick-files', async () => {
    if (!engine) return { count: 0 };
    const opts = { title: 'Choose files to capture', properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> };
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return { count: 0 };
    for (const filePath of result.filePaths) {
      engine.enqueue({ kind: 'file', payload: filePath, source: 'drop' });
    }
    return { count: result.filePaths.length };
  });
  ipcMain.handle('review:list', () => (engine ? engine.listReview() : []));
  ipcMain.handle('review:confirm', (_e, id: string, categoryId: string | null, stage?: string) => { engine?.confirmReview(id, categoryId, stage); });
  ipcMain.handle('review:skip', (_e, id: string) => { engine?.skipReview(id); });
  ipcMain.handle('categories:list', () => (engine ? engine.listCategories() : []));
}

function registerPublishVaultClip(config: AppConfig): void {
  const vp = config.vaultPath;
  ensureActiveVaultRegistered(config);

  // ─── T3-7: Publish (local read-only PWA + dashboard) + T3-4 clip endpoint ──
  ipcMain.handle('publish:status', () => publishStatus());

  ipcMain.handle('publish:stop', async (): Promise<PublishStatus> => {
    if (publishServer) {
      await new Promise<void>((res) => publishServer!.close(() => res()));
      publishServer = null;
      publishPortInUse = 0;
    }
    return publishStatus();
  });

  ipcMain.handle('publish:start', async (): Promise<PublishStatus> => {
    if (publishServer && publishServer.listening) return publishStatus();
    if (!coreReady || !store || !searchEngine) {
      throw new Error('AI engine still loading — try Publish again in a moment.');
    }
    const port = getSettings().publishPort ?? 3105;
    if (port === 3000) throw new Error('Port 3000 is reserved — pick another in Settings.');

    const core = await import('@stellavault/core');
    // Build the read-only Express app via core's createApiServer (dashboard data
    // routes + search), then layer the dormant dashboard HTML + PWA on top, plus
    // our own clip endpoint (T3-4). We DON'T call the returned .start() — we own
    // the http.Server so we can stop it cleanly.
    const api = core.createApiServer({
      store,
      searchEngine,
      port,
      vaultName: basename(vp) || 'Vault',
      vaultPath: vp,
      ...(decayEngine ? { decayEngine } : {}),
    });
    const expressApp = api.app;

    // Mount the dormant dashboard + PWA (read-only browsing / mobile on-ramp).
    if (typeof (core as any).mountDashboard === 'function') (core as any).mountDashboard(expressApp);
    if (typeof (core as any).mountPWA === 'function') (core as any).mountPWA(expressApp);

    // T3-4: web clipper endpoint. Unlike core's /clip (which re-fetches the URL
    // server-side), this accepts the page HTML/selection the BROWSER already has
    // — no SSRF surface, and we capture exactly what the user selected. Writes a
    // markdown note into the vault, then auto-embeds + seeds decay so it's
    // searchable immediately. Local-only (server binds 127.0.0.1); no auth token
    // is required for the extension POST since the surface is loopback + the
    // payload is browser-supplied content, not a fetch instruction.
    const { Router } = await import('express');
    const clipRouter = Router();
    clipRouter.post('/clip', async (req, res) => {
      try {
        const { url, html, selection, title } = req.body ?? {};
        const text = String(selection || html || '').slice(0, 100_000);
        if (!text.trim()) { res.status(400).json({ error: 'selection or html required' }); return; }

        // Strip tags if raw HTML was sent (selection is usually plain text).
        const looksHtml = /<\/?[a-z][\s\S]*>/i.test(text);
        let body = looksHtml
          ? text
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
              .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
              .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
              .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
              .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
              .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
              .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
              .replace(/<br\s*\/?>(?!\n)/gi, '\n')
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
              .replace(/\n{3,}/g, '\n\n').trim()
          : text.trim();
        if (body.length > 20_000) body = body.slice(0, 20_000) + '\n\n…(truncated)';

        const safeUrl = typeof url === 'string' ? url.slice(0, 2000) : '';
        const rawTitle = String(title || (safeUrl ? new URL(safeUrl).hostname : 'Web clip')).trim();
        const safeTitle = rawTitle.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Web clip';

        const date = new Date().toISOString().slice(0, 10);
        const clipDir = join(vp, 'Clips');
        mkdirSync(clipDir, { recursive: true });
        // Unique filename — never clobber an earlier clip the same day.
        let fileName = `${date} ${safeTitle}.md`;
        let i = 2;
        while (existsSync(join(clipDir, fileName))) fileName = `${date} ${safeTitle} (${i++}).md`;
        const fullPath = join(clipDir, fileName);

        const sourceLine = safeUrl ? `\nsource: "${safeUrl.replace(/"/g, "'")}"` : '';
        const md = `---\ntitle: "${safeTitle.replace(/"/g, "'")}"${sourceLine}\nclipped: ${date}\ntags: [clip]\n---\n\n# ${safeTitle}\n\n${safeUrl ? `> Source: ${safeUrl}\n\n` : ''}${body}\n`;
        noteSelfWrite(fullPath); // W1-15 watcher echo guard — our own write
        writeFileSync(fullPath, md, 'utf-8');
        bumpVaultFsVersion();

        // Auto-embed + seed decay so the clip is searchable + tracked immediately.
        try {
          if (typeof (core as any).indexFiles === 'function') {
            await (core as any).indexFiles(vp, [fullPath], { store, embedder, chunkOptions: coreChunkOptions });
          } else {
            await core.indexVault(vp, { store, embedder, chunkOptions: coreChunkOptions });
          }
          bumpGraphCacheVersion();
          if (decayEngine) {
            const documentId = docIdForFile(vp, fullPath);
            await decayEngine.recordAccess({ documentId, type: 'view', timestamp: new Date().toISOString() }).catch(() => {});
          }
        } catch (idxErr) {
          console.error('[publish] clip auto-index failed:', idxErr);
        }

        res.json({ success: true, fileName, savedTo: toVaultRel(vp, fullPath) });
      } catch (err) {
        console.error('[publish] clip failed:', err);
        res.status(500).json({ error: 'Clip failed' });
      }
    });
    expressApp.use('/api', clipRouter);

    publishServer = expressApp.listen(port, '127.0.0.1');
    publishPortInUse = port;
    await new Promise<void>((res, rej) => {
      publishServer!.once('listening', () => res());
      publishServer!.once('error', (e) => { publishServer = null; publishPortInUse = 0; rej(e); });
    });
    console.error(`[publish] read-only server at http://127.0.0.1:${port}/dashboard`);
    return publishStatus();
  });

  // ─── T3-9: multi-vault switcher + cross-vault search ──────────────────────
  ipcMain.handle('vault:list-registry', (): VaultRegistryEntry[] => {
    return ensureActiveVaultRegistered(config);
  });

  ipcMain.handle('vault:add-to-registry', async (): Promise<VaultRegistryEntry | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Add a vault folder',
      message: 'Choose a folder containing .md notes',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    if (!settingsStore) settingsStore = new SettingsStore();
    const list = settingsStore.get().vaults ?? [];
    // Don't double-add the same folder.
    if (list.some((v) => resolve(v.path) === resolve(path))) {
      return list.find((v) => resolve(v.path) === resolve(path)) ?? null;
    }
    // A new vault gets its own DB next to the shared store dir, keyed by slug so
    // each vault has an independent index (cross-vault search opens each in turn).
    const id = vaultSlug(basename(path), path);
    const dbPath = join(homedir(), '.stellavault', `${id}.db`);
    const entry: VaultRegistryEntry = { id, name: basename(path) || 'Vault', path, dbPath, active: false };
    settingsStore.set({ vaults: [...list, entry] });
    return entry;
  });

  // Pick a folder INSIDE the active vault → return its vault-relative path (for the
  // daily-notes / templates folder pickers in Settings). Rejects folders outside.
  ipcMain.handle('vault:pick-folder', async (): Promise<{ rel: string | null; outside?: boolean } | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const opts = { title: 'Select a folder inside your vault', defaultPath: vp, properties: ['openDirectory'] as Array<'openDirectory'> };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || !result.filePaths[0]) return null;
    const rel = relative(vp, result.filePaths[0]).replace(/\\/g, '/');
    if (rel.startsWith('..') || /^[a-zA-Z]:/.test(rel)) return { rel: null, outside: true };
    return { rel: rel || '.' };
  });

  ipcMain.handle('vault:remove-from-registry', (_e, id: string): VaultRegistryEntry[] => {
    if (!settingsStore) settingsStore = new SettingsStore();
    const list = settingsStore.get().vaults ?? [];
    // Never remove the active vault (the app is loaded for it).
    const filtered = list.filter((v) => !(v.id === id && !v.active));
    settingsStore.set({ vaults: filtered });
    return filtered;
  });

  // Switching re-points ~/.stellavault.json then asks for a restart — core
  // re-init (native SQLite + embedder reload + DB swap) is heavy and the watcher/
  // asset-protocol/IPC closures are all bound to the boot vault path. A clean
  // restart is far safer than hot-swapping every closure mid-session.
  // Confirmation happens in the renderer (themed ConfirmModal) — when this is
  // called the user already chose "Restart now". Rewrite the bootstrap config and
  // relaunch into the chosen vault (heavy core re-init; closures bound to boot path).
  ipcMain.handle('vault:switch', (e, id: string): { restartRequired: boolean } => {
    if (!settingsStore) settingsStore = new SettingsStore();
    const list = settingsStore.get().vaults ?? [];
    const target = list.find((v) => v.id === id);
    if (!target) throw new Error(`Unknown vault: ${id}`);
    // Defer the active-flag flip + bootstrap-config rewrite until the close round-trip
    // confirms (window:confirm-close). This routes the switch through the existing
    // dirty-tab guard — unsaved edits get the Save/Discard/Cancel prompt, and the
    // config is committed ONLY if the user actually lets the app close + relaunch.
    pendingVaultSwitch = { id, path: target.path, dbPath: target.dbPath };
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) {
      pendingVaultSwitch = null;
      throw new Error('Could not resolve window for vault switch.');
    }
    win.close(); // → 'close' guard → window:close-request → window:confirm-close commits it
    return { restartRequired: true };
  });

  ipcMain.handle('search:all-vaults', async (_e, query: string, limit?: number): Promise<CrossVaultResult[]> => {
    if (!coreReady || !embedder || !query?.trim()) return [];
    try {
      const core = await import('@stellavault/core');
      if (typeof (core as any).searchAllVaults !== 'function') return [];
      const list = getSettings().vaults ?? [];
      // core's searchAllVaults reads its OWN ~/.stellavault/vaults.json registry;
      // we keep the registry in desktop-settings, so mirror it across before the
      // call (add/replace each entry). addVault throws on dupes → guard with list.
      try {
        const existing: any[] = typeof (core as any).listVaults === 'function' ? (core as any).listVaults() : [];
        const existingIds = new Set(existing.map((v) => v.id));
        for (const v of list) {
          if (!existingIds.has(v.id) && typeof (core as any).addVault === 'function') {
            (core as any).addVault(v.id, v.name, v.path, v.dbPath, false);
          }
        }
      } catch (mirrorErr) {
        console.error('[main] search:all-vaults registry mirror failed:', mirrorErr);
      }
      const dims = embedder.dimensions;
      const createStore = (dbPath: string) => (core as any).createSqliteVecStore(dbPath, dims);
      const results = await (core as any).searchAllVaults(query, embedder, createStore, { limit: limit ?? 20 });
      return (results ?? []).map((r: any): CrossVaultResult => ({
        vaultId: r.vaultId ?? '',
        vaultName: r.vaultName ?? '',
        title: r.title ?? 'Untitled',
        score: Math.round((r.score ?? 0) * 1000) / 1000,
        snippet: r.snippet ?? '',
        filePath: r.filePath ?? '',
      }));
    } catch (err) {
      console.error('[main] search:all-vaults failed:', err);
      return [];
    }
  });
}
// ─── [end publish/multi-vault agent block — impl] ────────────────────────

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
        // T2-2: targeted incremental reindex — pass ONLY the changed batch to
        // core.indexFiles (per-file hash-skip; absent paths = deletions) instead
        // of re-walking + re-hashing the whole vault via indexVault. Falls back
        // to indexVault on older core builds that lack indexFiles.
        if (coreReady && store && embedder) {
          try {
            const core = await import('@stellavault/core');
            const changedPaths = [...batch.keys()];
            if (typeof (core as any).indexFiles === 'function') {
              await (core as any).indexFiles(vp, changedPaths, { store, embedder, chunkOptions: coreChunkOptions });
            } else {
              await core.indexVault(vp, { store, embedder, chunkOptions: coreChunkOptions });
            }
          } catch (err) {
            console.error('[main] watcher reindex failed:', err);
          }
        }
        bumpGraphCacheVersion(); // T2-7: external vault changes invalidate the graph
        bumpVaultFsVersion(); // T2-8: external vault changes invalidate file-tree/note-title/backlinks caches
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

// ─── Asset protocol handler (T2-1) ───────────────────
// Streams app://vault/<relpath> off disk after the same assertInsideVault gate
// every FS IPC handler uses. The host segment is fixed to "vault"; everything
// after it is treated as a vault-relative path. net.fetch over a file:// URL
// (Electron 35) gives us a proper streamed Response with the right Content-Type
// for free — no manual mime mapping. Anything that fails path-safety or doesn't
// exist resolves to a 403/404 Response rather than throwing.
function registerAssetProtocol(config: AppConfig): void {
  const vp = config.vaultPath;
  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      // app://vault/<relpath> — only the "vault" host is served. CANONICAL host-pin
      // policy, CASE-SENSITIVE: new URL() does NOT lowercase a custom-scheme host,
      // so app://VAULT → hostname 'VAULT' → 404. Mirrored in the renderer — keep in
      // lockstep with packages/desktop/src/renderer/lib/sanitize.ts (APP_VAULT_RE /
      // enforceAppHost); tests/app-host-consistency.test.ts asserts both layers agree.
      if (url.hostname !== 'vault') {
        return new Response('Not found', { status: 404 });
      }
      // Decode percent-encoding (spaces, CJK filenames) and strip the leading /.
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (!rel) return new Response('Not found', { status: 404 });
      // CRIT-01 invariant: resolve inside the vault or reject. Throws on escape.
      const safe = assertInsideVault(vp, join(vp, rel));
      if (!existsSync(safe)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(safe).toString());
    } catch (err) {
      console.error('[main] asset protocol denied:', err);
      return new Response('Forbidden', { status: 403 });
    }
  });
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
  win.on('close', (event) => {
    if (boundsTimer) clearTimeout(boundsTimer);
    saveBounds();
    // T2-18: dirty-close round-trip. The first close attempt is intercepted and
    // delegated to the renderer (which knows tab dirty-state). The renderer either
    // saves/discards then signals window:confirm-close(true) → win.destroy(), which
    // re-enters here with closeConfirmed set so we let it through.
    if (closeConfirmed.has(win)) return;
    if (win.webContents.isDestroyed()) return; // nothing to ask; allow.
    event.preventDefault();
    win.webContents.send('window:close-request');
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

// ─── [auto-update agent owned block — T3-12] ─────────
// In-app auto-update via update-electron-app (Squirrel.Windows + Squirrel.Mac
// feed, served by the GitHub "Desktop Release" releases). Wired so installed
// users can receive the T1-1 fix and future releases.
//
// SIGNING GATE (important): production auto-update REQUIRES code signing on both
// Windows (Authenticode) and macOS (Developer ID + notarization). Without a
// signed build, Squirrel either refuses to apply the update (mac) or installs an
// unsigned/untrusted binary (win) — a security hazard and a broken UX. So the
// updater stays OFF by default and only arms when STELLAVAULT_AUTO_UPDATE=1 is
// set (CI sets it for signed release builds — see desktop-release.yml notes).
// Unsigned local/dev builds therefore NEVER attempt a network update; 'update:check'
// returns a clear "disabled" status and the app keeps working normally.
//
// update-electron-app is resolved via a runtime dynamic import so a missing dep
// (it's optional in dev) degrades gracefully instead of crashing main startup.

let autoUpdateArmed = false;
let lastUpdateStatus = 'not configured';

function broadcastUpdateStatus(kind: string, message: string, version?: string): void {
  lastUpdateStatus = message;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:status', { kind, message, ...(version ? { version } : {}) });
  }
}

/** Manual "Check for updates" entry point (IPC update:check). */
function checkForUpdatesNow(): string {
  if (!autoUpdateArmed) {
    const why = app.isPackaged
      ? 'disabled: set STELLAVAULT_AUTO_UPDATE=1 on a signed build to enable'
      : 'disabled: auto-update only runs in packaged signed builds';
    broadcastUpdateStatus('disabled', why);
    return why;
  }
  try {
    // electron's autoUpdater is what update-electron-app drives under the hood.
    const { autoUpdater } = require('electron') as typeof import('electron');
    broadcastUpdateStatus('checking', 'checking for updates…');
    autoUpdater.checkForUpdates();
    return 'checking';
  } catch (err) {
    const msg = `check failed: ${err instanceof Error ? err.message : String(err)}`;
    broadcastUpdateStatus('error', msg);
    return msg;
  }
}

/** Configure update-electron-app on startup. No-op (status only) when the build
 *  is unpackaged or the signing gate (STELLAVAULT_AUTO_UPDATE=1) is not set. */
async function setupAutoUpdate(): Promise<void> {
  // Only packaged builds have a real updater + a feed; dev runs are skipped.
  if (!app.isPackaged) {
    broadcastUpdateStatus('disabled', 'disabled: development build');
    return;
  }
  if (process.env.STELLAVAULT_AUTO_UPDATE !== '1') {
    broadcastUpdateStatus('disabled', 'disabled: unsigned build (set STELLAVAULT_AUTO_UPDATE=1 on a signed release)');
    return;
  }
  try {
    // Indirected specifier so tsc doesn't statically require the (optional) dep
    // at compile time — it's resolved at runtime in packaged builds (the dep is
    // bundled then). vite-ignore keeps the Vite main build from pre-bundling it.
    const specifier = 'update-electron-app';
    const mod: any = await import(/* @vite-ignore */ specifier);
    const updateElectronApp = mod.updateElectronApp ?? mod.default ?? mod;
    const UpdateSourceType = mod.UpdateSourceType;
    updateElectronApp({
      // GitHub releases feed via update.electronjs.org (matches the repo the
      // Desktop Release workflow publishes to).
      ...(UpdateSourceType
        ? {
            updateSource: {
              type: UpdateSourceType.ElectronPublicUpdateService,
              repo: 'Evanciel/stellavault',
            },
          }
        : {}),
      updateInterval: '1 hour',
      notifyUser: true,
      logger: { log: (...a: unknown[]) => console.log('[update]', ...a), info: () => {}, warn: () => {}, error: (...a: unknown[]) => console.error('[update]', ...a) },
    });
    // Surface autoUpdater lifecycle to the renderer (manual-check feedback).
    const { autoUpdater } = require('electron') as typeof import('electron');
    autoUpdater.on('checking-for-update', () => broadcastUpdateStatus('checking', 'checking for updates…'));
    autoUpdater.on('update-available', () => broadcastUpdateStatus('available', 'update available — downloading…'));
    autoUpdater.on('update-not-available', () => broadcastUpdateStatus('not-available', 'you are on the latest version'));
    autoUpdater.on('update-downloaded', (_e: unknown, _notes: string, name: string) =>
      broadcastUpdateStatus('downloaded', 'update downloaded — restart to install', name));
    autoUpdater.on('error', (err: Error) => broadcastUpdateStatus('error', `update error: ${err?.message ?? err}`));
    autoUpdateArmed = true;
    broadcastUpdateStatus('idle', 'auto-update enabled');
  } catch (err) {
    console.error('[main] setupAutoUpdate failed:', err);
    broadcastUpdateStatus('error', `auto-update unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}
// ─── [end auto-update agent block] ───

// ─── App lifecycle ───────────────────────────────────

app.whenReady().then(async () => {
  // CI / local launch verification — prove core + native modules load in the
  // PACKAGED app, then exit. Must run before any window/dialog work.
  if (process.argv.includes('--smoke-core')) {
    await runSmokeCore();
    return;
  }

  // T2-Task2: SecretStore requires safeStorage, which is only available after
  // app ready. Instantiate here, then run the one-time plaintext-key migration.
  try {
    secretStore = new SecretStore();
    if (!settingsStore) settingsStore = new SettingsStore();
    const legacyAi = settingsStore.get().ai as Record<string, unknown> | undefined;
    const patch = migrateLegacyApiKey(legacyAi, secretStore);
    if (patch) {
      settingsStore.set(patch as Parameters<typeof settingsStore.set>[0]);
      console.log('[main] migrated legacy plaintext API key into SecretStore');
    }
  } catch (err) {
    console.error('[main] SecretStore init or migration failed:', err);
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
  registerAssetProtocol(config);

  const win = createWindow();

  // ─── Memory diagnostics (OOM investigation) ──────────────────────────────
  // Large vaults have OOM'd the MAIN process after extended runtime. Log heap +
  // native memory (external/arrayBuffers) + suspect cache sizes every 30s so growth
  // is visible and ATTRIBUTABLE: heapUsed climbing → a JS structure leaks; external/
  // arrayBuffers climbing → native (the ONNX embedder / sqlite). Gate with
  // STELLAVAULT_NO_MEM_LOG=1. Cheap (one line / 30s); unref'd so it never holds the app up.
  if (process.env.STELLAVAULT_NO_MEM_LOG !== '1') {
    const mb = (n: number) => Math.round(n / 1048576);
    const memTimer = setInterval(() => {
      const m = process.memoryUsage();
      console.error(
        `[mem] rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB ` +
        `external=${mb(m.external)}MB arrayBuffers=${mb(m.arrayBuffers)}MB | ` +
        `graphCache=${graphBuildCache.size} clusterCache=${clusteredCache.size} ` +
        `selfWrites=${recentSelfWrites.size} mcpAct=${mcpActivity.length} ` +
        `wins=${BrowserWindow.getAllWindows().length}`,
      );
    }, 30_000);
    memTimer.unref?.();
    app.on('before-quit', () => clearInterval(memTimer));
  }

  // Startup race guard: initCore now resolves FAST (embedder + decay moved off the
  // critical path), so it can finish BEFORE the renderer registers its 'core:ready'
  // listener — a one-shot send would be missed → permanent "Waiting for AI engine…".
  // Re-emit when the renderer finishes loading, if core is already up. (The renderer
  // also queries 'core:get-ready' on mount as a belt-and-suspenders.)
  win.webContents.on('did-finish-load', () => {
    if (coreReady) win.webContents.send('core:ready');
  });

  // Init core in background — don't block window creation
  void initCore(config).then(() => {
    win.webContents.send('core:ready');
    // W1-15: start after core init so the first change-batch can reindex
    // immediately. Events still flow if core failed (reindex is guarded).
    startVaultWatcher(config);
    // T3-3: auto-start the Agent Memory MCP server if the user opted in. Off the
    // critical path; only after core is ready so the server has a live store.
    try {
      if (!settingsStore) settingsStore = new SettingsStore();
      if (settingsStore.get().mcpAutoStart) void startMcpServer();
    } catch (err) {
      console.error('[main] MCP auto-start check failed:', err);
    }
  });

  // T3-12: configure in-app auto-update (no-op on unsigned/dev builds — see
  // setupAutoUpdate's signing gate). Off the critical path; failures are logged.
  void setupAutoUpdate();
});

// T3-3: stop the embedded MCP server on quit so its loopback port is released.
app.on('before-quit', () => {
  void stopMcpServer();
});

// SP1 chat: abort every in-flight stream on quit so no net.request outlives the app
// (no orphaned sockets, no send-after-destroy). SEPARATE listener — the two existing
// before-quit handlers above are untouched.
app.on('before-quit', () => {
  for (const { controller } of chatStreamRegistry.values()) {
    try { controller.abort(); } catch { /* already aborted */ }
  }
  chatStreamRegistry.clear();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
