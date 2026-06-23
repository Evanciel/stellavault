// Typed IPC channel definitions shared between main and preload.
// Every channel has a name, argument tuple, and return type.

import type { ClusterLevelGraph, ClusterMembersGraph } from '@stellavault/core';

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

// Coach panel (T2-6) — surfaces the dormant gap/learning-path engines.
// CoachGaps mirrors core's GapReport + predictive gaps, mapped to absolute
// filePaths where a document is involved (clickable to open). Topics/bridges
// have no single source note (filePath === '') and render as prompts.
export interface CoachIsolatedNote {
  documentId: string;
  title: string;
  connections: number;
  filePath: string;     // absolute; '' if not resolvable
}
export interface CoachGapPair {
  clusterA: string;
  clusterB: string;
  bridgeCount: number;
  suggestedTopic: string;
  severity: 'high' | 'medium' | 'low';
}
export interface CoachPredictedGap {
  topic: string;
  reason: string;
  confidence: number;   // 0-1
  category: 'adjacent' | 'bridging' | 'deepening';
}
export interface CoachGaps {
  totalClusters: number;
  totalGaps: number;
  gaps: CoachGapPair[];
  isolated: CoachIsolatedNote[];
  predicted: CoachPredictedGap[];
}
// One learning-path entry. filePath is absolute when a concrete note backs the
// item (category 'review'); '' for bridge/explore prompts that have no note yet.
export interface CoachLearningItem {
  documentId: string;
  title: string;
  reason: string;
  priority: 'critical' | 'important' | 'suggested';
  score: number;        // 0-100, higher = more urgent
  category: 'review' | 'explore' | 'bridge';
  filePath: string;     // absolute; '' if no backing note
}
export interface CoachLearningPath {
  items: CoachLearningItem[];
  summary: { reviewCount: number; exploreCount: number; bridgeCount: number; estimatedMinutes: number };
}

// ─── Publish / multi-vault / web clipper (T3-7 / T3-9 / T3-4) ───

// T3-7: state of the local read-only Publish server. running=false → never
// started or stopped; url is the loopback address (127.0.0.1:<port>) to open in
// a browser. The server hosts the dormant core dashboard + read-only PWA and the
// clip endpoint (T3-4) for the browser extension. LOCAL ONLY — bound to 127.0.0.1.
export interface PublishStatus {
  running: boolean;
  url: string;     // '' when not running
  port: number;
}

// T3-9: a registered vault in the desktop vault registry (mirrors core's
// multi-vault VaultEntry, but stored in desktop-settings so the switcher and the
// "search all vaults" toggle work without the core CLI). `active` marks the vault
// the app booted with (loadAppConfig). Switching is a restart (re-init is heavy).
export interface VaultRegistryEntry {
  id: string;       // short stable alias (slug of name/path)
  name: string;     // display name
  path: string;     // vault folder path
  dbPath: string;   // index.db path
  active: boolean;   // currently loaded vault
}

// T3-9: one cross-vault search hit (title + similarity + snippet only — never the
// full note), tagged with the source vault so the UI can group/label by vault.
export interface CrossVaultResult {
  vaultId: string;
  vaultName: string;
  title: string;
  score: number;
  snippet: string;
  filePath: string;   // vault-relative (cross-vault notes aren't all open-able locally)
}

// ─── T3-1: Wiki Synthesis panel ──────────────────────────────────────────────
// 'core:synthesize' compiles a cited article on a topic (or the current note's
// title) from the vault. `article` is markdown with [[Title]] backlinks the panel
// renders as clickable wikilinks. `synthesized` distinguishes a real LLM answer
// (API key configured) from the extractive fallback. `sources` back the citations.
export interface SynthesisSourceRef {
  title: string;
  filePath: string;   // absolute; '' if not resolvable
  snippet: string;
}
export interface SynthesisResult {
  topic: string;
  article: string;        // markdown, may contain [[Title]] wikilinks
  synthesized: boolean;   // true = LLM-synthesized, false = extractive fallback
  sources: SynthesisSourceRef[];
}

// ─── T3-8: contradiction + duplicate nudges ──────────────────────────────────
// Wired from core detectContradictions / detectDuplicates. Both pairs carry
// absolute filePaths (clickable to open the pair). Empty on an unindexed vault.
export interface DuplicateNudge {
  docA: { title: string; filePath: string };
  docB: { title: string; filePath: string };
  similarity: number;   // 0-1
}
export interface ContradictionNudge {
  docA: { title: string; filePath: string; statement: string };
  docB: { title: string; filePath: string; statement: string };
  similarity: number;   // 0-1
  confidence: number;   // 0-1
  type: 'negation' | 'value_conflict' | 'temporal' | 'semantic';
}

// ─── Decision journal / ADR capture (T3-5) ──────────────────────────────────
// Mirrors the core decision-journal MCP tool. A decision is a markdown file under
// <vault>/decisions/ with frontmatter (title/date/project/type:decision). The
// capture modal collects these fields; the Decisions view lists past entries.
export interface DecisionInput {
  title: string;
  context?: string;
  decision: string;
  alternatives?: string[];
  reasoning: string;
  project?: string;
}
// A past decision surfaced in the Decisions view. filePath is absolute (open-able);
// snippet is the first ~300 chars of the file for preview/search.
export interface DecisionEntry {
  fileName: string;
  filePath: string;     // absolute
  title: string;
  date: string;         // YYYY-MM-DD ('' if unparseable)
  project: string;
  snippet: string;
}
// One row of the knowledge-evolution timeline (get-evolution): which notes changed
// most recently (proxy for semantic drift). filePath absolute where resolvable.
export interface EvolutionEntry {
  documentId: string;
  title: string;
  filePath: string;     // absolute; '' if not resolvable
  lastModified: string;
  daysSinceModified: number;
  tags: string[];
}

// ─── Auto-linker (T3-6) ──────────────────────────────────────────────────────
// One suggested wikilink: a plain-text `phrase` in the note body that matches an
// existing vault note `target`. The user confirms before any are applied.
export interface LinkSuggestion {
  phrase: string;       // the literal text found in the body
  target: string;       // the vault note title it would link to ([[target|phrase]])
}
// Result of analysing a note body: the suggestions found + the fully-linked body
// (apply-all preview). The renderer shows `suggestions` for review, then writes
// `linkedBody` (recomposed with frontmatter) into the tab when accepted.
export interface AutoLinkResult {
  suggestions: LinkSuggestion[];
  linkedBody: string;   // body with ALL suggestions applied
}

// ─── Agent Memory / MCP server (T3-3) ────────────────────────────────────────
// Live state of the embedded MCP server ("Agent Memory" — local FSRS-pruned
// memory that Claude reads/writes). running=false → never started or stopped.
// toolCount is the number of tools the server exposes; port is the loopback HTTP
// port. recent is a small in-process activity log (tool name + ts) when the
// server has run any tool calls; empty if none yet. LOCAL ONLY — 127.0.0.1.
export interface McpActivity {
  tool: string;
  detail: string;       // short, e.g. a query string or doc title — never full text
  ts: number;           // epoch ms
}
export interface McpStatus {
  running: boolean;
  port: number;
  toolCount: number;
  recent: McpActivity[];
  error?: string;       // last start failure message, if any
}

// App settings — persisted at ~/.stellavault/desktop-settings.json (W1-1).
// Defaults live in main/settings-store.ts (getDefaults) and mirror this shape.
export interface AppSettings {
  version: 1;
  theme: 'dark' | 'light' | 'system';
  // i18n: interface language (KO/EN). Optional so older settings files type-check.
  language?: 'en' | 'ko';
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
  // T3-9: vault registry — the set of vaults the switcher offers. Optional so
  // older settings files type-check; main getDefaults seeds it from the booted
  // vault on first run. The `active` entry is the one core is currently loaded
  // for; switching writes a new active flag and requires an app restart.
  vaults?: VaultRegistryEntry[];
  // T3-7: local Publish server port. Project port registry convention (3105 —
  // never 3000). Optional; defaults in both main getDefaults + renderer DEFAULT.
  publishPort?: number;
  // T3-2: AI synthesis provider/model config. Optional — when a key is stored in
  // SecretStore, the Ask panel and Wiki Synthesis use the LLM synthesizer; otherwise
  // extractive. apiKey is INTENTIONALLY ABSENT here: the renderer never sees the raw
  // key. settings:get returns hasKey/keychainAvailable instead (redact-secrets.ts).
  // The raw key only travels via 'secret:set-key' (write-only, main stores in
  // SecretStore/safeStorage). model defaults to the latest Claude model id for the
  // anthropic provider (see settings-store getDefaults).
  ai?: {
    provider: 'none' | 'anthropic' | 'openai' | 'openai-compatible' | 'google';
    model: string;
    baseURL?: string; // only for provider 'openai-compatible' (e.g. http://localhost:11434/v1)
    /** True when SecretStore has a key for this provider (renderer display only). */
    hasKey?: boolean;
    /** True when safeStorage (OS keychain) backed the key (renderer display only). */
    keychainAvailable?: boolean;
  };
  // T3-3: auto-start the embedded MCP server ("Agent Memory") on app launch.
  // Optional; defaults false in both main getDefaults + renderer DEFAULT.
  mcpAutoStart?: boolean;
}

// ─── Second-brain auto-capture (Design §6) ──────────────────────────────────
// One pipeline behind every door (drag-drop / MCP / clip). CaptureRequest is the IPC
// arg to 'vault:capture'; the DTOs below back the Capture/Review/Category panels
// (centroids/embeddings are NEVER sent to the renderer).
export type CaptureKind = 'file' | 'url' | 'text';
export type CaptureSource = 'drop' | 'mcp' | 'clip';
export type CaptureStage = 'fleeting' | 'literature' | 'permanent';

export interface CaptureRequest {
  kind: CaptureKind;
  payload: string;            // file: tmp abs path | url: URL | text: raw markdown
  title?: string;
  tags?: string[];
  source: CaptureSource;
  sourceMeta?: { fileName?: string; mime?: string; client?: string; html?: string; selection?: string; base64?: string };
  stageHint?: CaptureStage;
}
export interface CaptureOutcome {
  status: 'created' | 'duplicate' | 'queued' | 'rejected';
  savedTo?: string;
  documentId?: string;
  title?: string;
  stage?: CaptureStage;
  categories?: string[];
  confidence?: number;
  decision?: 'auto' | 'review';
  duplicateOf?: string;
  reason?: 'engine-loading' | 'size' | 'unsupported' | 'ssrf' | 'no-vault' | 'queue-full' | 'io';
  indexed?: boolean;
}
export interface CaptureItem {
  id: string;
  kind: CaptureKind;
  title: string;
  source: CaptureSource;
  status: 'queued' | 'processing' | 'done' | 'rejected' | 'duplicate';
  savedTo?: string;
  category?: string;
  confidence?: number;
  decision?: 'auto' | 'review';
  reason?: string;
  enqueuedAt: string;
}
export interface ReviewItem {
  id: string;
  notePath: string;
  title: string;
  confidence: number;
  suggestions: { id: string; label: string; sim: number }[];
  stage?: string;
}
export interface CategoryInfo {
  id: string;
  label: string;
  origin: 'emergent' | 'user' | 'seed';
  memberCount: number;
  keywords: string[];
}
export interface CaptureCounts {
  capturedToday: number;
  pendingReviewCount: number;
  queueDepth: number;
  watching: boolean;
}

// ─── SP1 multiturn chat (docs/02-design/multimedia-chat-sp1-plan.md §3) ──────
// A chat turn. `text` is a single string (SP1 is text-only; SP3 widens to content
// blocks without a body-builder rewrite). `incomplete` marks a partial / aborted /
// refused turn (§7) — saved as-is and resumable. `citations` ride assistant turns
// and are persisted as title+filePath only (Decision 2 — snippet stripped at rest).
// NO apiKey/secret ever appears in any chat type (Invariant §6 — key stays in main).
export type ChatRole = 'user' | 'assistant' | 'system';
export interface ChatCitation {
  title: string;
  filePath: string;     // absolute; '' if not resolvable
  snippet?: string;     // live display only; NOT persisted (Decision 2)
}
export interface ChatMessage {
  id: string;           // renderer-generated (crypto.randomUUID) per turn
  role: ChatRole;
  text: string;
  ts: number;           // epoch ms
  incomplete?: boolean; // partial / aborted / refused turn (§7)
  citations?: ChatCitation[]; // assistant turns only
}
// Session list row (⑨). `id` is the UUID filename; `title` is a metadata field
// (rename writes this, NEVER the filename); `updated` is last-saved epoch ms.
export interface ChatSessionMeta {
  id: string;
  title: string;
  updated: number;
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

  // Coach panel (T2-6) — dormant differentiators surfaced. 'core:gaps' fuses
  // detectKnowledgeGaps (cluster bridges + isolated notes) with predictKnowledgeGaps
  // (topology-predicted topics); 'core:learning-path' fuses the decay report with
  // gaps via generateLearningPath. Both degrade to empty on an unindexed vault.
  'core:gaps':          { args: []; result: CoachGaps };
  'core:learning-path': { args: [limit?: number]; result: CoachLearningPath };

  // T3-1: Wiki Synthesis — compile a cited article on a topic from the vault.
  // T3-8: contradiction + duplicate nudges (detectContradictions/detectDuplicates).
  'core:synthesize':    { args: [topic: string]; result: SynthesisResult };
  'core:contradictions':{ args: [limit?: number]; result: ContradictionNudge[] };
  'core:duplicates':    { args: [limit?: number]; result: DuplicateNudge[] };

  // Draft (Express)
  'core:draft':         { args: [topic: string, format?: string]; result: { title: string; content: string; sources: string[] } };

  // Graph
  'graph:build':        { args: [mode: string]; result: { nodes: unknown[]; edges: unknown[] } };
  // Wave 1 cluster-first LOD (docs/02-design/graph-scale-lod-redesign.md).
  'graph:clusters':       { args: [opts?: { mode?: string }]; result: ClusterLevelGraph };
  'graph:expand-cluster': { args: [opts: { mode?: string; clusterId: number }]; result: ClusterMembersGraph };
  // Startup race guard — renderer queries this on mount (see App.tsx).
  'core:get-ready':       { args: []; result: boolean };

  // Backlinks
  'backlinks:find':     { args: [title: string]; result: Array<{ filePath: string; name: string; line: string }> };

  // Window
  'window:minimize':    { args: []; result: void };
  'window:maximize':    { args: []; result: void };
  'window:close':       { args: []; result: void };
  // App menu (W2) — webContents zoom; returns the new zoom factor.
  'window:zoom':        { args: [action: 'in' | 'out' | 'reset']; result: number };
  // T2-18: dirty-close round-trip. Main intercepts the window close, emits the
  // 'window:close-request' event; the renderer inspects dirty tabs. If any are
  // dirty it invokes 'window:close-dialog' (main shows a native Save/Discard/
  // Cancel box and returns the choice), then signals the outcome back via
  // 'window:confirm-close' (proceed=true → main destroys the window; false →
  // abort and keep running).
  'window:close-dialog':  { args: []; result: 'save' | 'discard' | 'cancel' };
  'window:confirm-close': { args: [proceed: boolean]; result: void };

  // Shell (W2 — app menu). open-path is vault-root restricted; open-external is https-only.
  'shell:open-path':     { args: [path: string]; result: void };
  'shell:open-external': { args: [url: string]; result: void };

  // Settings (W1-1)
  'settings:get':       { args: []; result: AppSettings };
  'settings:set':       { args: [patch: Partial<AppSettings>]; result: AppSettings };
  // T5: apiKey removed from args — key is loaded from secretStore in the main process.
  // The renderer passes only provider + optional baseURL (needed for openai-compatible/Ollama).
  // A compromised renderer can no longer pass an arbitrary key to trigger outbound requests.
  'ai:list-models':     { args: [opts: { provider: string; baseURL?: string }]; result: string[] };
  // T4: write-only key IPC. No ai:get-secret / read-secret exists by design —
  // the plaintext key NEVER returns to the renderer after being stored.
  'ai:set-secret':   { args: [provider: string, key: string]; result: void };
  'ai:has-secret':   { args: [provider: string]; result: boolean };
  'ai:clear-secret': { args: [provider: string]; result: void };

  // [editor-upgrade additive] Local image import — copies image bytes (base64)
  // into <vault>/assets/, returns the VAULT-RELATIVE path. (The legacy srcPath
  // arbitrary-file-read branch was removed in T1-1; the renderer only sends bytes.)
  'vault:import-asset': { args: [payload: { base64?: string; fileName: string }]; result: string };

  // ─── Publish / read-only PWA (T3-7) + web clipper (T3-4) ───
  // 'publish:start' boots the local read-only server (core dashboard + PWA +
  // /clip endpoint) on settings.publishPort, returns the new status.
  // 'publish:stop' shuts it down. 'publish:status' is a cheap poll for the UI.
  'publish:start':  { args: []; result: PublishStatus };
  'publish:stop':   { args: []; result: PublishStatus };
  'publish:status': { args: []; result: PublishStatus };

  // ─── Multi-vault (T3-9) ───
  // 'vault:list-registry' returns the registry (seeded from the booted vault).
  // 'vault:add-to-registry' opens a folder picker in main (returns null if
  // cancelled) and appends a non-active entry. 'vault:switch' marks a registry
  // entry active + rewrites ~/.stellavault.json, then returns whether a restart
  // is needed (always true — core re-init is heavy). 'vault:remove-from-registry'
  // drops a non-active entry. 'search:all-vaults' runs core searchAllVaults.
  'vault:list-registry':      { args: []; result: VaultRegistryEntry[] };
  'vault:add-to-registry':    { args: []; result: VaultRegistryEntry | null };
  'vault:pick-folder':        { args: []; result: { rel: string | null; outside?: boolean } | null };
  'vault:remove-from-registry': { args: [id: string]; result: VaultRegistryEntry[] };
  'vault:switch':             { args: [id: string]; result: { restartRequired: boolean } };
  'search:all-vaults':        { args: [query: string, limit?: number]; result: CrossVaultResult[] };

  // ─── In-app auto-update (T3-12) ───
  // 'app:get-version' = the running app version (About box / update UI).
  // 'update:check' triggers a manual update check; the result is a human status
  // string (e.g. "checking", "disabled: unsigned build", "not configured").
  // Progress/result is also pushed asynchronously via the 'update:status' event.
  'app:get-version':  { args: []; result: string };
  'update:check':     { args: []; result: string };

  // ─── Decision journal / ADR capture (T3-5) ───
  // 'decision:log' writes a structured decision file under <vault>/decisions/ and
  // returns the absolute path. 'decision:list' returns recent decisions (newest
  // first); an empty query lists all (capped). 'decision:evolution' returns the
  // knowledge-evolution timeline (most-changed notes) for the Decisions view.
  'decision:log':       { args: [input: DecisionInput]; result: { filePath: string; fileName: string } };
  'decision:list':      { args: [query?: string]; result: DecisionEntry[] };
  'decision:evolution': { args: [limit?: number]; result: EvolutionEntry[] };

  // ─── Auto-linker (T3-6) ───
  // 'autolink:suggest' analyses a note body against existing vault titles and
  // returns suggestions + an apply-all preview. selfTitle prevents self-linking.
  'autolink:suggest':   { args: [body: string, selfTitle?: string]; result: AutoLinkResult };

  // ─── Agent Memory / MCP server (T3-3) ───
  // 'mcp:start' boots the embedded MCP HTTP server (Agent Memory) on settings'
  // port; 'mcp:stop' shuts it down; 'mcp:status' is a cheap poll for the UI.
  'mcp:start':  { args: []; result: McpStatus };
  'mcp:stop':   { args: []; result: McpStatus };
  'mcp:status': { args: []; result: McpStatus };

  // ─── Second-brain auto-capture (Design §6.4) ───
  'vault:capture':      { args: [req: CaptureRequest]; result: { id: string } };
  'capture:list':       { args: [limit?: number]; result: CaptureItem[] };
  'capture:set-paused': { args: [paused: boolean]; result: void };
  'capture:counts':     { args: []; result: CaptureCounts };
  'capture:pick-files': { args: []; result: { count: number } };
  'review:list':        { args: []; result: ReviewItem[] };
  'review:confirm':     { args: [id: string, categoryId: string | null, stage?: string]; result: void };
  'review:skip':        { args: [id: string]; result: void };
  'categories:list':    { args: []; result: CategoryInfo[] };

  // ─── SP1 multiturn chat (multimedia-chat-sp1-plan §3) ───
  // Streaming command (renderer→main). result:void — tokens stream back via the
  // 'chat:chunk'/'chat:done'/'chat:error' EVENTS (targeted to e.sender, filtered by
  // streamId). The API key NEVER appears in these args (main reads SecretStore).
  // sessionId routes the persisted assistant turn to the right session on done.
  'chat:send':  { args: [req: { messages: ChatMessage[]; streamId: string; sessionId: string; ragOn: boolean }]; result: void };
  'chat:abort': { args: [streamId: string]; result: void };
  // Session CRUD (⑨) — filenames are UUIDs; rename writes a title FIELD, not the path.
  'chat:list-sessions':  { args: []; result: ChatSessionMeta[] };
  'chat:load-session':   { args: [id: string]; result: ChatMessage[] | null };
  'chat:rename-session': { args: [id: string, title: string]; result: void };
  'chat:delete-session': { args: [id: string]; result: void };

  // ─── Local model server (Ollama) lifecycle (SP1 follow-up) ───
  // Powers the "Start Ollama" affordance in Settings → AI and the chat 'unreachable'
  // error banner. ollama:start spawns a FIXED binary (no renderer-supplied path/args);
  // baseURL is used ONLY for the HTTP reachability probe.
  'ollama:status': { args: [opts?: { baseURL?: string }]; result: { reachable: boolean; installed: boolean } };
  'ollama:start':  { args: [opts?: { baseURL?: string }]; result: { ok: boolean; reason?: 'already-running' | 'not-installed' | 'spawn-failed' | 'timeout' } };
  // Compat check: installed version vs the current-model floor (older Ollama 412s on new models).
  'ollama:version': { args: []; result: { version: string | null } };
  'ollama:compat':  { args: []; result: { installed: boolean; version: string | null; minVersion: string; outdated: boolean } };
  // Auto-download latest Ollama (button-prompt). Download bytes stream via the
  // 'ollama:download-progress' EVENT; the resolved invoke result reports the outcome.
  'ollama:download': { args: []; result: { ok: boolean; binPath?: string; version?: string | null; reason?: string } };
}

// ─── Events (main → renderer, one-way) ───

export interface IpcEventMap {
  'file:changed':     { filePath: string; event: 'add' | 'change' | 'unlink' };
  'index:progress':   { current: number; total: number; title: string };
  'settings:changed': AppSettings;
  // T2-18: main asks the renderer to vet a pending window close (dirty tabs).
  'window:close-request': void;
  // T3-12: auto-update lifecycle pushed from update-electron-app's autoUpdater.
  // kind: checking | available | not-available | downloaded | error | disabled.
  'update:status': { kind: string; message: string; version?: string };
  // T3-3: MCP server status change (started/stopped) or a new tool-call activity
  // entry — lets the Agent Memory section update its feed without polling.
  'mcp:status-changed': McpStatus;
  // Second-brain capture lifecycle (Design §6.4).
  'capture:progress': { id: string; phase: string };
  'capture:done':     CaptureOutcome & { id: string };
  'review:changed':   { queueLength: number };

  // ─── SP1 multiturn chat streaming (main → renderer, e.sender targeted) ───
  // Filtered by streamId on the renderer (onIpc fires for ALL chat events on this
  // window). NEVER broadcast — main sends only to the originating webContents.
  'chat:chunk': { streamId: string; delta: string };
  'chat:done':  { streamId: string; citations?: ChatCitation[] };
  // category mirrors chat-engine's ErrorCategory union (kept in sync; shared/ must
  // not import main/, so the union is inlined here as the wire-shape source of truth).
  'chat:error': {
    streamId: string;
    message: string;
    category?: 'key-missing' | 'rate-limited' | 'refused' | 'too-large' | 'aborted' | 'unreachable' | 'model-missing' | 'generic';
  };
}

// Helper types for typed invoke/on
export type IpcChannel = keyof IpcChannelMap;
export type IpcArgs<C extends IpcChannel> = IpcChannelMap[C]['args'];
export type IpcResult<C extends IpcChannel> = IpcChannelMap[C]['result'];
