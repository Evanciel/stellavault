// Design Ref: §4.2 — Core Internal API (Facade)
// Design Ref: §9.3 — Dependency Injection Pattern

export { loadConfig, DEFAULT_FOLDERS, resolveSearchWeights } from './config.js';
export type { StellavaultConfig, FolderNames, SearchWeightConfig } from './config.js';

// Types
export type { Document } from './types/document.js';
export type { Chunk, ScoredChunk } from './types/chunk.js';
export type {
  SearchResult,
  SearchOptions,
  TopicInfo,
  StoreStats,
} from './types/search.js';

// Interfaces
export type { VectorStore } from './store/types.js';
export type { Embedder } from './indexer/embedder.js';

// Store
export { createSqliteVecStore } from './store/index.js';

// Indexer
export { indexVault, indexFiles, scanVault, scanFile, docIdForPath, chunkDocument, createLocalEmbedder, createWatcher } from './indexer/index.js';
export type { IndexResult, IndexerOptions, SkipReason, SkippedFile } from './indexer/index.js';

// Search
export { createSearchEngine, DEFAULT_SIGNAL_WEIGHTS } from './search/index.js';
export type { SearchEngine, SignalWeights } from './search/index.js';

// MCP
export { createMcpServer } from './mcp/index.js';

// Intelligence (gap cache for explicit invalidation by callers — 2026-05-15)
export { invalidateGapCache, readCachedGapReport, computeAndCacheGaps, getGapReport } from './intelligence/gap-cache.js';

// Pack (Phase 3)
export { createPack, exportPack, importPack, packToSummary, maskPII } from './pack/index.js';
export type { KnowledgePack, PackChunk, PackInfo, CreatePackOptions, ImportResult, MaskResult } from './pack/index.js';

// API (Phase 2)
export { createApiServer } from './api/server.js';
export type { ApiServerOptions } from './api/server.js';
export type { GraphNode, GraphEdge, Cluster, GraphData, GraphResponse } from './types/graph.js';
// Plan SC: §0-B2 — buildGraphData was internal-only; desktop main process calls core.buildGraphData via IPC.
// Contract note (§4-F): GraphData nodes never carry positions — consumers must lay out (e.g. hash(id) seed).
export { buildGraphData } from './api/graph-data.js';
export type { BuildGraphOptions, GraphMode } from './api/graph-data.js';

// Intelligence (Phase 4b)
export { DecayEngine } from './intelligence/decay-engine.js';
export type { DecayState, AccessEvent, DecayReport, ReviewGrade } from './intelligence/types.js';
export { computeRetrievability, updateStability, updateStabilityGraded, estimateInitialStability, elapsedDays } from './intelligence/fsrs.js';
export { detectDuplicates } from './intelligence/duplicate-detector.js';
export { detectKnowledgeGaps } from './intelligence/gap-detector.js';
export type { KnowledgeGap, GapReport } from './intelligence/gap-detector.js';
export { detectContradictions } from './intelligence/contradiction-detector.js';
export type { ContradictionPair } from './intelligence/contradiction-detector.js';
export { computeSemanticDrift, findMostDrifted, hashEmbedding } from './intelligence/semantic-versioning.js';
export type { SemanticChangelog, SemanticVersion } from './intelligence/semantic-versioning.js';
export { predictKnowledgeGaps } from './intelligence/predictive-gaps.js';
export type { PredictedGap } from './intelligence/predictive-gaps.js';
export type { DuplicatePair } from './intelligence/duplicate-detector.js';
export { generateLearningPath } from './intelligence/learning-path.js';
export { askVault } from './intelligence/ask-engine.js';
export type { Synthesizer, SynthesisSource } from './intelligence/ask-engine.js';
export { compileWiki, scanRawDirectory, extractConcepts } from './intelligence/wiki-compiler.js';
// T3-6: auto-linker — desktop "Suggest links for this note" command wires these.
export { collectVaultTitles, insertWikilinks, autoLink } from './intelligence/auto-linker.js';
// T3-5: decision journal (ADR capture) — desktop log/find IPC wires these
// MCP-only handlers directly (previously only reachable via the MCP server).
export { handleLogDecision, handleFindDecisions } from './mcp/tools/decision-journal.js';
export { createGetEvolutionTool } from './mcp/tools/get-evolution.js';
export { lintKnowledge } from './intelligence/knowledge-lint.js';
export {
  scanFrontmatter, generateNextIndexCode, assignIndexCodes,
  getInboxItems, archiveFile, checkAtomicity, detectOrphansAndBrokenLinks,
} from './intelligence/zettelkasten.js';
export type { FrontmatterEntry } from './intelligence/zettelkasten.js';
export { ingest, ingestBatch, promoteNote } from './intelligence/ingest-pipeline.js';
export type { IngestInput, IngestResult, NoteStage } from './intelligence/ingest-pipeline.js';
export type { LintResult, LintIssue } from './intelligence/knowledge-lint.js';
export type { AskResult } from './intelligence/ask-engine.js';
export type { LearningPath, LearningItem, LearningPathInput } from './intelligence/learning-path.js';
export { checkNotifications } from './intelligence/notifications.js';
export type { Notification, NotificationConfig } from './intelligence/notifications.js';

// Multi-Vault
export { addVault, removeVault, listVaults, getVault, searchAllVaults } from './multi-vault/index.js';
export type { VaultEntry, CrossVaultSearchResult } from './multi-vault/index.js';

// Voice Capture
export { captureVoice, transcribeAudio, isWhisperAvailable } from './capture/voice.js';
export type { CaptureResult, CaptureOptions } from './capture/voice.js';

// Dashboard + PWA
export { mountDashboard } from './api/dashboard.js';
export { mountPWA } from './api/pwa.js';

// Agentic Graph
export { createAgenticGraphTools } from './mcp/tools/agentic-graph.js';

// Cloud
export { syncToCloud, restoreFromCloud, getSyncState, encrypt, decrypt, getOrCreateEncryptionKey } from './cloud/index.js';
export type { CloudConfig, SyncResult } from './cloud/index.js';

// Team
export { inviteMember, authenticateMember, hasPermission, listMembers, removeMember, createAuthMiddleware, loadTeamConfig, generateToken } from './team/index.js';
export type { TeamMember, TeamRole, TeamConfig } from './team/index.js';

// Pack Marketplace
export { searchMarketplace, createPackageJson, getPublishInstructions } from './pack/marketplace.js';
export type { PackListing } from './pack/marketplace.js';

// Federation
export { FederationNode, FederatedSearch, getOrCreateIdentity, isFederationExperimentalEnabled } from './federation/index.js';
export type { PeerInfo, FederatedSearchResult, FederationMessage, NodeIdentity } from './federation/index.js';
export { vouch, revoke, block, getTrustLevel, isBlocked, listTrusted, computeTrustScore } from './federation/trust.js';
export { loadSharingConfig, saveSharingConfig, isDocumentShareable, sanitizeSnippet, getSharingSummary, addBlockedTag, removeBlockedTag, addBlockedFolder, blockDocument, unblockDocument, getDocumentLevel, getAccessibleLevel, buildLeveledResult, setTagLevel, setFolderLevel, setNodeLevel, setDefaultLevel, createFullTextRequest, approveRequest, denyRequest, getPendingRequests, LEVEL_LABELS, LEVEL_ICONS, LEVEL_CREDIT_MULTIPLIER } from './federation/sharing.js';
export type { SharingConfig, SharingLevel, SharingRule, FullTextRequest, LeveledSearchResult } from './federation/sharing.js';
export { computeReputation, verifyConsensus, recordInteraction, recordConsistency, recordFeedback, recordConsensus, getReputationBoard, filterByReputation } from './federation/reputation.js';
export type { ReputationRecord } from './federation/reputation.js';
export type { TrustEntry } from './federation/trust.js';
export { addDPNoise, addDPNoiseNormalized, maskSnippet } from './federation/privacy.js';
export type { DPConfig } from './federation/privacy.js';
export { getBalance, getAccount, earn, spend, earnForSearchResponse, spendForSearch, getRecentTransactions } from './federation/credits.js';
export type { CreditAccount, CreditTransaction } from './federation/credits.js';

// Plugin SDK
export { PluginManager } from './plugins/index.js';
export type { StellavaultPlugin, PluginManifest, PluginEvent, PluginContext } from './plugins/index.js';
export { WebhookManager } from './plugins/webhooks.js';
export type { WebhookConfig, WebhookDelivery } from './plugins/webhooks.js';
export { loadCustomTools } from './mcp/custom-tools.js';
export type { CustomToolDef, LoadedCustomTool } from './mcp/custom-tools.js';

// i18n
export { t, setLocale, getLocale, detectLocale } from './i18n/index.js';
export type { Locale } from './i18n/index.js';

// Error Recovery
export { withRetry, StellavaultError, wrapError, errors } from './utils/retry.js';
export type { RetryOptions } from './utils/retry.js';

// Math Utils
export { cosineSimilarity, dotProduct, normalizeVector, euclideanDist } from './utils/math.js';

// Factory — 전체 조립
import { createSqliteVecStore as _createStore } from './store/index.js';
import { createLocalEmbedder as _createEmbedder } from './indexer/index.js';
import { createSearchEngine as _createSearch } from './search/index.js';
import { createMcpServer as _createMcp } from './mcp/index.js';
import { DecayEngine as _DecayEngine } from './intelligence/decay-engine.js';
import { resolveSearchWeights as _resolveSearchWeights } from './config.js';

export function createKnowledgeHub(
  config: import('./config.js').StellavaultConfig,
  options: { ready?: Promise<void> } = {},
) {
  const embedder = _createEmbedder(config.embedding.localModel);
  const dims = embedder.dimensions;
  const store = _createStore(config.dbPath, dims);

  // B3 §3.4 — lazy, memoized DecayEngine for the recency signal. store.getDb() is
  // only valid after store.initialize() (lazy-init arch); search runs only after
  // `ready` resolves, so resolving the engine at first query is safe. Mirrors the
  // detect-gaps lazy db getter in mcp/server.ts. Returns undefined until ready.
  let _decay: _DecayEngine | null = null;
  const getDecayEngine = (): _DecayEngine | undefined => {
    if (_decay) return _decay;
    try {
      const db = store.getDb();
      if (!db) return undefined;
      _decay = new _DecayEngine(db as any);
      return _decay;
    } catch {
      return undefined;
    }
  };

  // B3 §4 — config + env-resolved per-signal weights (entity 0.5, recency 0.2 defaults).
  const sw = _resolveSearchWeights(config);
  const searchEngine = _createSearch({
    store,
    embedder,
    rrfK: config.search.rrfK,
    weights: { semantic: sw.semantic, bm25: sw.bm25, entity: sw.entity, recency: sw.recency },
    getDecayEngine,
    entityAliases: config.search.entityAliases, // B2.2 — cross-lingual/synonym groups
  });
  const mcpServer = _createMcp({ store, searchEngine, vaultPath: config.vaultPath, ready: options.ready });

  // T2-15: expose the SAME lazy DecayEngine the search recency re-rank uses, so
  // desktop (and other embedders) record accesses against the identical instance
  // instead of constructing a standalone `new DecayEngine(db)`. Both share one DB,
  // but a single instance avoids divergent in-process state / double-init.
  return { store, embedder, searchEngine, mcpServer, config, getDecayEngine };
}
