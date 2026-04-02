// Design Ref: §3.1 — Core Types (Search)

import type { Chunk } from './chunk.js';
import type { Document } from './document.js';

export interface SearchResult {
  chunk: Chunk;
  document: Document;
  /** RRF 통합 점수 (0~1) */
  score: number;
  /** 매칭 부분 하이라이트 */
  highlights: string[];
}

export interface SearchOptions {
  query: string;
  /** default: 10 */
  limit?: number;
  /** minimum score, default: 0.1 */
  threshold?: number;
  /** 태그 필터 */
  tags?: string[];
  /** 날짜 범위 필터 */
  dateRange?: { from?: string; to?: string };
}

export interface TopicInfo {
  topic: string;
  count: number;
  recentDocuments: Array<{ id: string; title: string }>;
}

export interface StoreStats {
  documentCount: number;
  chunkCount: number;
  dbSizeBytes: number;
  lastIndexed: string | null;
}
