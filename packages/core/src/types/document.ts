// Design Ref: §3.1 — Core Types (Document)

export interface Document {
  /** SHA-256 hash of file path */
  id: string;
  /** vault 기준 상대 경로 */
  filePath: string;
  /** frontmatter title 또는 첫 heading */
  title: string;
  /** 전체 마크다운 텍스트 */
  content: string;
  /** YAML frontmatter */
  frontmatter: Record<string, unknown>;
  /** #태그 목록 */
  tags: string[];
  /** ISO 8601 */
  lastModified: string;
  /** SHA-256 of content (증분 인덱싱용) */
  contentHash: string;
  /** 출처: local | notion | clip | bridge | pack */
  source?: string;
  /** 노트 유형: note | clip | sync | bridge | decision | snapshot */
  type?: string;
}
