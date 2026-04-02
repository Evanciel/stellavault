// Design Ref: §3.1 — Core Types (Chunk)

export interface Chunk {
  /** document.id + "#" + chunkIndex */
  id: string;
  /** 소속 문서 ID */
  documentId: string;
  /** 청크 텍스트 */
  content: string;
  /** 소속 heading (## 제목) */
  heading: string;
  /** 원문 시작 줄 번호 */
  startLine: number;
  /** 원문 끝 줄 번호 */
  endLine: number;
  /** 토큰 수 */
  tokenCount: number;
  /** 768차원 벡터 (로딩 시 선택적) */
  embedding?: number[];
}

export interface ScoredChunk {
  chunkId: string;
  score: number;
}
