// Classification engine — local-first note categorization for the second-brain pipeline.
// Design Ref: §6.2 — second-brain-autocapture-design.md.
export * from './types.js';
export { classifyLocal, jaccard } from './classify.js';
export { createClassifyDao, ensureClassifyTables } from './dao.js';
export type { ClassifyDao } from './dao.js';
export { safeMove } from './safe-move.js';
export type { SafeMoveResult } from './safe-move.js';
export { cosineKMeans, meanVector } from './cluster.js';
export { discoverCategories, topEntities } from './discover.js';
export type { DiscoverDoc, DiscoverOptions, DiscoverResult } from './discover.js';
