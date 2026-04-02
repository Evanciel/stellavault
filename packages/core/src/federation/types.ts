// Design Ref: §2.2 — Federation 공유 타입 정의

export interface PeerInfo {
  peerId: string;
  displayName: string;
  documentCount: number;
  topTopics: string[];
  joinedAt: string;
  lastSeen: string;
}

export interface FederatedSearchResult {
  title: string;
  similarity: number;
  snippet: string;       // 원문 첫 50자
  peerId: string;
  peerName: string;
}

// Design Ref: §7 — 메시지 프로토콜 (JSON + newline delimiter)
export type FederationMessage =
  | { type: 'handshake'; peerId: string; displayName: string; version: string; documentCount: number; topTopics: string[] }
  | { type: 'search_query'; queryId: string; embedding: number[]; limit: number }
  | { type: 'search_result'; queryId: string; results: Array<{ title: string; similarity: number; snippet: string }> }
  | { type: 'leave'; peerId: string };
