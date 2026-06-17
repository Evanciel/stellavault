// Design Ref: §3.2 — 교체 가능 설계 (VectorStore 인터페이스)

import type { Chunk, ScoredChunk, Document, TopicInfo, StoreStats } from '../types/index.js';

/** content-free 문서 투영 — 그래프/통계용. 본문(content)을 힙에 적재하지 않아
 *  대규모(수십만~) 볼트에서 getAllDocuments() 의 OOM 을 회피한다(그래프는 본문 불요). */
export interface DocumentMeta {
  id: string;
  filePath: string;
  title: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  lastModified: string;
  source?: string;
  type?: string;
}

export interface VectorStore {
  initialize(): Promise<void>;
  upsertDocument(doc: Document): Promise<void>;
  upsertChunks(chunks: Chunk[]): Promise<void>;
  deleteByDocumentId(documentId: string): Promise<void>;
  searchSemantic(embedding: number[], limit: number): Promise<ScoredChunk[]>;
  searchKeyword(query: string, limit: number): Promise<ScoredChunk[]>;
  /** 엔티티(위키링크/태그/명사구) 겹침 기반 검색 — Upgrade B2.
   *  exactExtra: alias/synonym terms matched EXACT-only (no fuzzy broadening). B2.2 */
  searchEntities(entities: string[], limit: number, exactExtra?: string[]): Promise<ScoredChunk[]>;
  getDocument(documentId: string): Promise<Document | null>;
  getChunk(chunkId: string): Promise<Chunk | null>;
  getAllDocuments(): Promise<Document[]>;
  /** content-free 문서 메타 목록 (그래프 노드용 — 본문 미적재로 대규모 OOM 회피). */
  getDocumentsMeta(maxDocs?: number): Promise<DocumentMeta[]>;
  getTopics(): Promise<TopicInfo[]>;
  getStats(): Promise<StoreStats>;
  /** 각 문서의 첫 청크 임베딩 반환 (graph용) */
  getDocumentEmbeddings(maxDocs?: number): Promise<Map<string, number[]>>;
  /**
   * 지정한 문서들의 첫 청크 임베딩만 반환 (graph용 — 노드 상한만큼만 로드).
   * 전체 12k 임베딩을 vec0 가상테이블에서 읽으면 ~11s; 필요한 1.5k만 chunk_id PK로
   * 읽으면 ~0.3s (38×). buildGraphData 는 최근성 상위 N개만 쓰므로 이걸 사용.
   */
  getDocumentEmbeddingsByIds(documentIds: string[]): Promise<Map<string, number[]>>;
  /** sqlite-vec KNN으로 유사 문서 검색 (graph edge용, O(K log n)) */
  findDocumentNeighbors(embedding: number[], limit: number): Promise<Array<{ documentId: string; similarity: number }>>;
  close(): Promise<void>;
  /** 내부 DB 인스턴스 접근 (Intelligence Layer용) */
  getDb(): unknown;
}
