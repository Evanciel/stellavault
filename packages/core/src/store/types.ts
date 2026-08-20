// Design Ref: §3.2 — 교체 가능 설계 (VectorStore 인터페이스)

import type { Chunk, ScoredChunk, Document, TopicInfo, StoreStats } from '../types/index.js';
import type { LinkRow } from '../links/wikilink.js';

export type { LinkRow };

/** 해석에 성공한 위키링크 한 건 — 그래프 엣지의 원재료. */
export interface LinkPair {
  sourceDocId: string;
  targetDocId: string;
}

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
  /**
   * 한 문서가 내보내는 위키링크 전량 교체.
   *
   * 일반 색인 경로에서는 부를 필요가 없다 — upsertDocument 가 content 에서 링크를 파생해
   * 같은 트랜잭션에 기록한다. 원래는 "upsertDocument 뒤에 이걸 부른다"는 호출부 규약이었는데,
   * 안 지키는 경로가 4개 있었고(INSERT OR REPLACE → ON DELETE CASCADE) 그때마다 링크가
   * 조용히 사라졌다. 규약 대신 구조로 옮긴 이유다.
   *
   * 남겨둔 용도: 본문 없이 링크만 다시 써야 하는 경우(백필/복구/테스트).
   */
  upsertLinks(sourceDocId: string, links: LinkRow[]): Promise<void>;
  /**
   * 저장된 링크를 문서 id 쌍으로 해석한다. 해석 실패(broken, 실측 11.55%)는 제외.
   * links 테이블에는 target_doc_id 를 두지 않으므로 해석은 항상 이 질의 시점에 일어난다.
   */
  getLinkPairs(): Promise<LinkPair[]>;
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
  /**
   * 한 임베딩의 유사 문서 상위 N개. **단건 조회용**이다.
   *
   * 그래프 엣지를 만들려고 문서마다 호출하면 안 된다 — 실볼트 실측 220 ms/문서(17,303 문서 = 약
   * 63분). sqlite-vec 의 MATCH k=? 는 근사 인덱스가 아니라 전수 스캔이라 문서당 쿼리 오버헤드가
   * 그대로 곱해진다. 전체 엣지는 graph-data.ts 의 인메모리 전수 코사인이 37배 빠르다.
   * (예전 주석의 "O(K log n)" 은 사실이 아니었다 — 구현 주석 참조.)
   */
  findDocumentNeighbors(embedding: number[], limit: number): Promise<Array<{ documentId: string; similarity: number }>>;
  close(): Promise<void>;
  /** 내부 DB 인스턴스 접근 (Intelligence Layer용) */
  getDb(): unknown;
}
