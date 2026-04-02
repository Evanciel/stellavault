// Design Ref: §3.2 — 교체 가능 설계 (VectorStore 인터페이스)

import type { Chunk, ScoredChunk, Document, TopicInfo, StoreStats } from '../types/index.js';

export interface VectorStore {
  initialize(): Promise<void>;
  upsertDocument(doc: Document): Promise<void>;
  upsertChunks(chunks: Chunk[]): Promise<void>;
  deleteByDocumentId(documentId: string): Promise<void>;
  searchSemantic(embedding: number[], limit: number): Promise<ScoredChunk[]>;
  searchKeyword(query: string, limit: number): Promise<ScoredChunk[]>;
  getDocument(documentId: string): Promise<Document | null>;
  getChunk(chunkId: string): Promise<Chunk | null>;
  getAllDocuments(): Promise<Document[]>;
  getTopics(): Promise<TopicInfo[]>;
  getStats(): Promise<StoreStats>;
  /** 각 문서의 첫 청크 임베딩 반환 (graph용) */
  getDocumentEmbeddings(): Promise<Map<string, number[]>>;
  close(): Promise<void>;
  /** 내부 DB 인스턴스 접근 (Intelligence Layer용) */
  getDb(): unknown;
}
