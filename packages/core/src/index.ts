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
export type { DuplicatePair } from './intelligence/duplicate-detector.js';

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
