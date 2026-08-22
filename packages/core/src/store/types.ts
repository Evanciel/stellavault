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
  /**
   * 1회성 유지보수(링크 백필 · 고아 임베딩 정리). <소유가 확인된 뒤에만> 부른다.
   *
   * 🔴 initialize() 안에 있었는데, 그러면 스토어를 여는 것만으로 남의 DB 에 쓴다
   *    (코덱스 12차 P1). "한 글자도 안 쓴다" 를 지키려면 여는 것과 고치는 것이
   *    분리돼 있어야 한다.
   */
  runMaintenanceOnce(): void;
  upsertDocument(doc: Document): Promise<void>;
  upsertChunks(chunks: Chunk[]): Promise<void>;
  /**
   * 문서와 그 청크를 <한 트랜잭션으로> 교체한다. **색인 경로는 반드시 이것을 쓴다.**
   *
   * 🔴 upsertDocument 와 upsertChunks 를 <따로> 부르면 안 된다. 앞의 것이 쓰는
   *    `INSERT OR REPLACE INTO documents` 는 행을 지웠다 다시 넣으므로 FK 의
   *    ON DELETE CASCADE 가 그 문서의 <기존 청크를 전부 날린다>. 그 뒤 청크 쓰기가
   *    실패하면 문서 행은 있는데 청크가 0 개 — 행은 남았는데 <검색이 안 되는> 유실이다.
   *    실측 2026-08-21: 청크 1개짜리 문서를 upsertDocument 로만 갱신 → 검색 1건 → 0건.
   */
  replaceDocument(doc: Document, chunks: Chunk[]): Promise<void>;
  /**
   * 문서 내용만 갱신하고 <청크는 보존>한다. 임베더가 없는 경로용.
   *
   * 🔴 upsertDocument 를 단독으로 부르지 마라 — cascade 로 청크가 사라져
   *    그 문서가 <검색에서 없어진다>. 다시 구울 수 없다면 이것을 쓴다.
   *    content_hash 를 비워 다음 색인이 반드시 다시 굽게 한다.
   */
  upsertDocumentPreservingChunks(doc: Document): Promise<void>;
  /**
   * 1회성 마커·소유권 표식 저장소(`stellavault_meta`). 동기 API 다 — 부트스트랩에서
   * <색인을 시작하기 전에> 물어야 하기 때문이다.
   */
  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
  /**
   * 원자적 소유권 주장. 값이 <없을 때만> 쓰고, 어느 쪽이 이겼든 <최종 소유자>를 돌려준다.
   *
   * 🔴 `getMeta` → `setMeta` 두 걸음으로 나누면 동시에 도는 두 색인이 <둘 다> 주장에
   *    성공한다 — 둘 다 "내 DB 다" 라고 믿고 서로의 문서를 지운다 (코덱스 10차 P1).
   *    이 볼트에는 실제로 색인 프로세스가 여럿 붙는다(잠금은 아직 없다).
   */
  claimMeta(key: string, value: string): string;
  deleteByDocumentId(documentId: string): Promise<void>;
  /**
   * 여러 문서 행을 <한 트랜잭션으로> 지운다.
   *
   * 🔴 한 파일이 정본·옛형식 <두 행>일 수 있다. 하나씩 지우다 두 번째에서 예외가 나면
   *    상태가 <부분 삭제>가 되고, 그 뒤 무엇을 보고하든 거짓이 된다 — deleted 를 세면
   *    "지웠다" 인데 한 행이 남아 계속 검색되고, 안 세면 "안 지웠다" 인데 한 행이 사라진
   *    상태다. 코덱스가 10차에 <양쪽 다> 지적했다. 부분 상태를 안 만드는 것이 답이다.
   */
  deleteByDocumentIds(documentIds: string[]): Promise<void>;
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
