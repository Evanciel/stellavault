// Design Ref: §2.2 — Federation 공유 타입 정의
// Plan: docs/01-plan/features/federation-security-v2.plan.md §2.4-§2.5

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

// Wire protocol v2: every message body lives inside an envelope that carries
// a sender identifier and an Ed25519 detached signature over the payload.
//
// `publicKeyHex` is only sent in the first HELLO of a connection; subsequent
// messages omit it and the recipient looks the key up by peerId from cache.
export interface SignedEnvelope<T = FederationMessage> {
  payload: T;
  peerId: string;
  /** Hex-encoded SPKI DER public key. Present only on first HELLO per connection. */
  publicKeyHex?: string;
  /** Hex-encoded 64-byte Ed25519 signature over canonical(payload). */
  signature: string;
}

// Design Ref: §7 — 메시지 프로토콜 (JSON + newline delimiter)
// v2 adds `hello` (replaces unsigned handshake), `challenge`, `challenge_response`.
// The legacy `handshake` variant is kept as a recognised-but-rejected type for
// clearer diagnostics when a v1 peer connects.
export type FederationMessage =
  | { type: 'hello'; peerId: string; displayName: string; version: string; documentCount: number; topTopics: string[]; nonce: string }
  | { type: 'challenge'; nonce: string }
  | { type: 'challenge_response'; signedNonce: string }
  | { type: 'ready'; documentCount: number; topTopics: string[] }
  | { type: 'search_query'; queryId: string; embedding: number[]; limit: number }
  | { type: 'search_result'; queryId: string; results: Array<{ title: string; similarity: number; snippet: string }> }
  | { type: 'leave'; peerId: string }
  /** Legacy v1 unsigned handshake. Only kept for diagnostic logging. */
  | { type: 'handshake'; peerId: string; displayName: string; version: string; documentCount: number; topTopics: string[] };

export type HandshakePhase = 'idle' | 'awaiting_challenge' | 'awaiting_response' | 'ready';
