// Design Ref: §4.2 — Core Internal API (Facade)
// Design Ref: §9.3 — Dependency Injection Pattern

export { loadConfig } from './config.js';
export type { StellavaultConfig } from './config.js';

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
export { indexVault, scanVault, chunkDocument, createLocalEmbedder } from './indexer/index.js';
export type { IndexResult, IndexerOptions } from './indexer/index.js';

// Search
export { createSearchEngine } from './search/index.js';
export type { SearchEngine } from './search/index.js';

// MCP
export { createMcpServer } from './mcp/index.js';

// Pack (Phase 3)
export { createPack, exportPack, importPack, packToSummary, maskPII } from './pack/index.js';
export type { KnowledgePack, PackChunk, PackInfo, CreatePackOptions, ImportResult, MaskResult } from './pack/index.js';

// API (Phase 2)
export { createApiServer } from './api/server.js';
export type { ApiServerOptions } from './api/server.js';
export type { GraphNode, GraphEdge, Cluster, GraphData, GraphResponse } from './types/graph.js';

// Intelligence (Phase 4b)
export { DecayEngine } from './intelligence/decay-engine.js';
export type { DecayState, AccessEvent, DecayReport } from './intelligence/types.js';
export { computeRetrievability, updateStability, estimateInitialStability, elapsedDays } from './intelligence/fsrs.js';
export { detectDuplicates } from './intelligence/duplicate-detector.js';
export { detectKnowledgeGaps } from './intelligence/gap-detector.js';
export { detectContradictions } from './intelligence/contradiction-detector.js';
export type { ContradictionPair } from './intelligence/contradiction-detector.js';
export { computeSemanticDrift, findMostDrifted, hashEmbedding } from './intelligence/semantic-versioning.js';
export type { SemanticChangelog, SemanticVersion } from './intelligence/semantic-versioning.js';
export { predictKnowledgeGaps } from './intelligence/predictive-gaps.js';
export type { PredictedGap } from './intelligence/predictive-gaps.js';
export type { DuplicatePair } from './intelligence/duplicate-detector.js';
export { generateLearningPath } from './intelligence/learning-path.js';
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
export { FederationNode, FederatedSearch, getOrCreateIdentity } from './federation/index.js';
export type { PeerInfo, FederatedSearchResult, FederationMessage, NodeIdentity } from './federation/index.js';
export { vouch, revoke, block, getTrustLevel, isBlocked, listTrusted, computeTrustScore } from './federation/trust.js';
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

// Factory — 전체 조립
import { createSqliteVecStore as _createStore } from './store/index.js';
import { createLocalEmbedder as _createEmbedder } from './indexer/index.js';
import { createSearchEngine as _createSearch } from './search/index.js';
import { createMcpServer as _createMcp } from './mcp/index.js';

export function createKnowledgeHub(config: import('./config.js').StellavaultConfig) {
  const embedder = _createEmbedder(config.embedding.localModel);
  const dims = embedder.dimensions;
  const store = _createStore(config.dbPath, dims);
  const searchEngine = _createSearch({ store, embedder, rrfK: config.search.rrfK });
  const mcpServer = _createMcp({ store, searchEngine, vaultPath: config.vaultPath });

  return { store, embedder, searchEngine, mcpServer, config };
}
