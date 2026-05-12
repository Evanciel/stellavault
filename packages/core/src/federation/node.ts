// Design Ref: §4 — FederationNode (Hyperswarm P2P)
// Plan SC: docs/01-plan/features/federation-security-v2.plan.md
//   §2.4 SignedEnvelope, §2.5 mutual challenge/response handshake,
//   §5 acceptance criteria.
//
// Wire format v2:
//   Every line is a SignedEnvelope { payload, peerId, publicKeyHex?, signature }.
//   - publicKeyHex is present only on the first HELLO sent over a connection.
//   - signature is a hex-encoded Ed25519 signature over canonical(payload).
//
// Handshake (mutual, both peers act symmetrically):
//   1. Connection open → both sides send HELLO with their own publicKey and a
//      fresh 32-byte challenge nonce.
//   2. On receiving the peer's HELLO, validate envelope signature and peerId
//      binding, then reply with CHALLENGE_RESPONSE signing the peer's nonce.
//   3. When our own challenge has been responded to AND we have responded to
//      the peer's challenge, the connection becomes "ready" and the peer is
//      registered. Only then are search_query/search_result messages accepted.

import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  getOrCreateIdentity,
  peerIdFromPublicKey,
  signMessage,
  verifySignature,
  type NodeIdentity,
} from './identity.js';
import type {
  FederationMessage,
  PeerInfo,
  SignedEnvelope,
} from './types.js';

const FEDERATION_TOPIC = createHash('sha256').update('stellavault-federation-v1').digest();

// Replay defence: remember recently consumed inbound nonces so a peer cannot
// reuse one. The cache now holds both HELLO challenge nonces and every
// post-handshake envelope nonce, so the bound is larger than v2 (~320KB at
// peak — acceptable per peer-limit of 50).
const REPLAY_CACHE_LIMIT = 10_000;

// Plan SC: federation-security-v2 §5 — post-review P2 hardening.
// Defaults are tuned for production peers (hyperswarm); tests override
// via `new FederationNode({ handshakeTimeoutMs, rateLimitPerSec, rateLimitBurst })`.
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;   // peers that don't reach `ready` within 30s are dropped
const DEFAULT_RATE_LIMIT_PER_SEC = 50;          // sustained per-peer envelope rate
const DEFAULT_RATE_LIMIT_BURST = 100;           // bucket capacity

/** Minimal Duplex stream interface shared by Hyperswarm and net.Socket */
interface PeerConnection {
  write(data: string): boolean;
  end(): void;
  on(event: 'data', listener: (data: Buffer) => void): this;
  on(event: 'close' | 'error', listener: () => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

/** Hyperswarm instance (optionalDependency, dynamically imported) */
interface HyperswarmInstance {
  on(event: string, listener: (...args: unknown[]) => void): this;
  join(topic: Buffer, opts: { server: boolean; client: boolean }): { flushed(): Promise<void> };
  destroy(): Promise<void>;
}

interface ConnectionState {
  conn: PeerConnection;
  /** Nonce we generated and sent to the peer; they must sign it. */
  ourNonce: Buffer;
  /** True after we've already written our HELLO over this connection. */
  helloSent: boolean;
  /** True once we have responded to the peer's HELLO challenge. */
  weResponded: boolean;
  /** True once the peer has responded to our challenge and the signature verifies. */
  peerVerified: boolean;
  /** Cached from the peer's HELLO. Null until HELLO is received. */
  peerPublicKey: Buffer | null;
  peerId: string | null;
  /** Snapshot of stats/profile from the peer's HELLO, applied at "ready". */
  pendingPeerInfo: PeerInfo | null;
  /** True once both sides have verified each other and the peer is registered. */
  ready: boolean;
  /** Drops the connection if the handshake hasn't completed in time. */
  handshakeTimer: ReturnType<typeof setTimeout> | null;
  /** Token-bucket counters for inbound envelope rate limiting. */
  rlTokens: number;
  rlLastRefill: number;
}

export class FederationNode extends EventEmitter {
  private swarm: HyperswarmInstance | null = null;
  private identity: NodeIdentity;
  private peers = new Map<string, { info: PeerInfo; conn: PeerConnection }>();
  private connStates = new WeakMap<PeerConnection, ConnectionState>();
  private replayCache = new Set<string>();
  private replayQueue: string[] = [];
  private running = false;
  private documentCount = 0;
  private topTopics: string[] = [];

  // Configurable per-instance — see constructor options.
  private readonly handshakeTimeoutMs: number;
  private readonly rateLimitPerSec: number;
  private readonly rateLimitBurst: number;

  /**
   * @param init Either a displayName string (legacy positional form) or an
   *             options object. Pass `{ identity }` to skip the on-disk identity
   *             load — useful for tests that need many ephemeral peers.
   *             `handshakeTimeoutMs` drops connections stuck in handshake
   *             (set to 0 to disable; default 30s).
   *             `rateLimitPerSec` / `rateLimitBurst` cap per-peer envelope
   *             processing rate (set rateLimitPerSec=0 to disable).
   */
  constructor(
    init?:
      | string
      | {
          displayName?: string;
          identity?: NodeIdentity;
          handshakeTimeoutMs?: number;
          rateLimitPerSec?: number;
          rateLimitBurst?: number;
        },
  ) {
    super();
    if (init && typeof init === 'object') {
      this.identity = init.identity ?? getOrCreateIdentity(init.displayName);
      this.handshakeTimeoutMs = init.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
      this.rateLimitPerSec = init.rateLimitPerSec ?? DEFAULT_RATE_LIMIT_PER_SEC;
      this.rateLimitBurst = init.rateLimitBurst ?? DEFAULT_RATE_LIMIT_BURST;
    } else {
      this.identity = getOrCreateIdentity(init);
      this.handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS;
      this.rateLimitPerSec = DEFAULT_RATE_LIMIT_PER_SEC;
      this.rateLimitBurst = DEFAULT_RATE_LIMIT_BURST;
    }
  }

  get peerId(): string { return this.identity.peerId; }
  get displayName(): string { return this.identity.displayName; }
  get peerCount(): number { return this.peers.size; }
  get isRunning(): boolean { return this.running; }

  setLocalStats(documentCount: number, topTopics: string[]) {
    this.documentCount = documentCount;
    this.topTopics = topTopics.slice(0, 5);
  }

  async join(): Promise<void> {
    if (this.running) return;

    const Hyperswarm = (await import('hyperswarm')).default;
    this.swarm = new Hyperswarm({ maxPeers: 50 });

    this.swarm.on('connection', (conn: unknown) => {
      this.handleConnection(conn as PeerConnection);
    });

    const discovery = this.swarm.join(FEDERATION_TOPIC, { server: true, client: true });
    await discovery.flushed();

    this.running = true;
    this.emit('joined', { peerId: this.peerId, topic: FEDERATION_TOPIC.toString('hex').slice(0, 16) });
  }

  async joinDirect(host: string, port: number): Promise<void> {
    const net = await import('node:net');
    const conn = net.connect(port, host);

    await new Promise<void>((resolve, reject) => {
      conn.on('connect', () => {
        this.handleConnection(conn);
        resolve();
      });
      conn.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 15000);
    });

    if (!this.running) this.running = true;
  }

  async leave(): Promise<void> {
    if (!this.running) return;

    for (const [, peer] of this.peers) {
      try {
        this.sendSigned(peer.conn, { type: 'leave', peerId: this.peerId });
        peer.conn.end();
      } catch { /* ignore */ }
    }

    this.peers.clear();
    await this.swarm?.destroy();
    this.swarm = null;
    this.running = false;
    this.emit('left');
  }

  getPeers(): PeerInfo[] {
    return [...this.peers.values()].map(p => p.info);
  }

  sendSearchQuery(peerId: string, queryId: string, embedding: number[], limit: number): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.sendSigned(peer.conn, { type: 'search_query', queryId, embedding, limit });
  }

  sendSearchResult(
    peerId: string,
    queryId: string,
    results: Array<{ title: string; similarity: number; snippet: string }>,
  ): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.sendSigned(peer.conn, { type: 'search_result', queryId, results });
  }

  // --- Private ---

  /**
   * Stable JSON for signing. Sorts keys recursively so nested objects
   * produced by different JS runtimes (or by future code paths that build
   * objects in a different insertion order) still hash identically on
   * both sides. RFC 8785-style canonicalization, scoped to what
   * FederationMessage / SignedEnvelope actually carry. Keys whose value
   * is `undefined` are omitted (matches JSON.stringify semantics), so
   * sender and receiver agree on optional fields like `publicKeyHex`.
   */
  private canonicalize(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map(v => this.canonicalize(v)).join(',') + ']';
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + this.canonicalize(obj[k])).join(',') + '}';
  }

  private sendSigned(conn: PeerConnection, payload: FederationMessage, includePublicKey = false) {
    try {
      const envBase: Omit<SignedEnvelope, 'signature'> = {
        payload,
        peerId: this.peerId,
        nonce: randomBytes(16).toString('hex'),
        ...(includePublicKey ? { publicKeyHex: this.identity.publicKey.toString('hex') } : {}),
      };
      const canonical = Buffer.from(this.canonicalize(envBase), 'utf-8');
      const sig = signMessage(this.identity.secretKey, canonical);
      const envelope: SignedEnvelope = { ...envBase, signature: sig.toString('hex') };
      conn.write(JSON.stringify(envelope) + '\n');
    } catch { /* connection may be closed */ }
  }

  private rememberNonce(nonceHex: string): boolean {
    if (this.replayCache.has(nonceHex)) return false;
    this.replayCache.add(nonceHex);
    this.replayQueue.push(nonceHex);
    if (this.replayQueue.length > REPLAY_CACHE_LIMIT) {
      const oldest = this.replayQueue.shift();
      if (oldest) this.replayCache.delete(oldest);
    }
    return true;
  }

  private handleConnection(conn: PeerConnection) {
    const state: ConnectionState = {
      conn,
      ourNonce: randomBytes(32),
      helloSent: false,
      weResponded: false,
      peerVerified: false,
      peerPublicKey: null,
      peerId: null,
      pendingPeerInfo: null,
      ready: false,
      handshakeTimer: null,
      rlTokens: this.rateLimitBurst,
      rlLastRefill: Date.now(),
    };
    this.connStates.set(conn, state);

    // Drop the connection if the handshake hasn't completed by the deadline.
    // Otherwise a peer that opens a socket and never sends HELLO would pin a
    // ConnectionState in memory forever.
    if (this.handshakeTimeoutMs > 0) {
      state.handshakeTimer = setTimeout(() => {
        if (state.ready) return;
        try { conn.end(); } catch { /* already closed */ }
        this.emit('handshake_timeout', { peerId: state.peerId });
      }, this.handshakeTimeoutMs);
      // Don't keep the event loop alive purely for this timer (server lifetime
      // is managed by the swarm or the explicit `leave()` call).
      const timer = state.handshakeTimer as unknown as { unref?: () => void };
      timer.unref?.();
    }

    // Send our HELLO with our publicKey + a fresh challenge for the peer to sign.
    this.sendSigned(
      conn,
      {
        type: 'hello',
        peerId: this.peerId,
        displayName: this.identity.displayName,
        version: '0.2.0',
        documentCount: this.documentCount,
        topTopics: this.topTopics,
        nonce: state.ourNonce.toString('hex'),
      },
      /* includePublicKey */ true,
    );
    state.helloSent = true;

    let buffer = '';
    const MAX_BUFFER = 1024 * 1024;
    const MAX_MESSAGE = 64 * 1024;

    conn.on('data', (data: Buffer) => {
      buffer += data.toString();
      if (buffer.length > MAX_BUFFER) {
        console.error('Federation: buffer overflow from peer, disconnecting');
        buffer = '';
        conn.end();
        return;
      }

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.length > MAX_MESSAGE) continue;
        this.dispatchLine(conn, line);
      }
    });

    conn.on('close', () => {
      const st = this.connStates.get(conn);
      if (st?.handshakeTimer) clearTimeout(st.handshakeTimer);
      this.connStates.delete(conn);
      if (st?.peerId && this.peers.get(st.peerId)?.conn === conn) {
        this.peers.delete(st.peerId);
        this.emit('peer_left', { peerId: st.peerId });
      }
    });

    conn.on('error', () => { /* swallow */ });
  }

  /**
   * Token-bucket admission control. Returns false when the inbound rate
   * exceeds the configured limit; the caller should drop the envelope
   * silently (we don't disconnect — the peer might be momentarily bursty,
   * not malicious, and a real attacker would just reconnect).
   */
  private admitEnvelope(state: ConnectionState): boolean {
    if (this.rateLimitPerSec <= 0) return true;
    const now = Date.now();
    const elapsed = (now - state.rlLastRefill) / 1000;
    if (elapsed > 0) {
      state.rlTokens = Math.min(this.rateLimitBurst, state.rlTokens + elapsed * this.rateLimitPerSec);
      state.rlLastRefill = now;
    }
    if (state.rlTokens < 1) {
      this.emit('rate_limited', { peerId: state.peerId });
      return false;
    }
    state.rlTokens -= 1;
    return true;
  }

  private dispatchLine(conn: PeerConnection, line: string) {
    const state = this.connStates.get(conn);
    if (!state) return;
    if (!this.admitEnvelope(state)) return;

    let envelope: SignedEnvelope;
    try {
      envelope = JSON.parse(line) as SignedEnvelope;
    } catch { return; }

    if (!envelope || typeof envelope !== 'object') return;
    if (typeof envelope.peerId !== 'string') return;
    if (typeof envelope.signature !== 'string') return;
    if (typeof envelope.nonce !== 'string') return;
    if (envelope.nonce.length < 16 || envelope.nonce.length > 128) return;
    if (!envelope.payload || typeof envelope.payload !== 'object') return;

    // Replay defence — every envelope (HELLO, search_query, search_result, leave,
    // …) is protected by a per-envelope nonce. If we've seen this nonce in the
    // recent past, drop the envelope before any signature work.
    if (!this.rememberNonce(envelope.nonce)) return;

    // Resolve the public key we should verify against.
    // - Before HELLO: use publicKeyHex from envelope (and validate peerId binding).
    // - After HELLO:  use the cached peerPublicKey; reject mismatched peerId.
    let publicKey: Buffer | null = null;
    if (!state.peerPublicKey) {
      if (envelope.payload && (envelope.payload as { type?: string }).type !== 'hello') return;
      if (!envelope.publicKeyHex || typeof envelope.publicKeyHex !== 'string') return;
      try { publicKey = Buffer.from(envelope.publicKeyHex, 'hex'); } catch { return; }
      const derived = peerIdFromPublicKey(publicKey);
      if (derived !== envelope.peerId) return; // peerId↔publicKey binding failed
    } else {
      if (envelope.peerId !== state.peerId) return;
      publicKey = state.peerPublicKey;
    }

    // Verify the envelope signature — signed over the entire envelope minus
    // the signature itself, so a peer cannot mutate peerId/nonce/publicKeyHex
    // and keep a valid signature.
    const { signature, ...envBase } = envelope;
    const canonical = Buffer.from(this.canonicalize(envBase), 'utf-8');
    let sigBuf: Buffer;
    try { sigBuf = Buffer.from(signature, 'hex'); } catch { return; }
    if (sigBuf.length !== 64) return;
    if (!verifySignature(publicKey, canonical, sigBuf)) return;

    this.handleMessage(conn, state, envelope.payload as FederationMessage, publicKey);
  }

  private handleMessage(
    conn: PeerConnection,
    state: ConnectionState,
    msg: FederationMessage,
    publicKey: Buffer,
  ) {
    switch (msg.type) {
      case 'hello': {
        if (state.peerPublicKey) return; // duplicate HELLO ignored
        if (typeof msg.peerId !== 'string' || typeof msg.nonce !== 'string') return;
        let nonceBuf: Buffer;
        try { nonceBuf = Buffer.from(msg.nonce, 'hex'); } catch { return; }
        if (nonceBuf.length !== 32) return;
        if (!this.rememberNonce(msg.nonce)) return; // replay defence

        state.peerPublicKey = publicKey;
        state.peerId = msg.peerId;
        state.pendingPeerInfo = {
          peerId: msg.peerId,
          displayName: (msg.displayName ?? '').slice(0, 50),
          documentCount: Math.min(msg.documentCount ?? 0, 1000000),
          topTopics: (msg.topTopics ?? []).slice(0, 10),
          joinedAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        };

        // Reply: sign the peer's nonce.
        const response = signMessage(this.identity.secretKey, nonceBuf);
        this.sendSigned(conn, {
          type: 'challenge_response',
          signedNonce: response.toString('hex'),
        });
        state.weResponded = true;
        this.maybeMarkReady(conn, state);
        break;
      }

      case 'challenge_response': {
        if (state.peerVerified) return;
        if (typeof msg.signedNonce !== 'string') return;
        let sigBuf: Buffer;
        try { sigBuf = Buffer.from(msg.signedNonce, 'hex'); } catch { return; }
        if (sigBuf.length !== 64) return;
        if (!verifySignature(publicKey, state.ourNonce, sigBuf)) return;
        state.peerVerified = true;
        this.maybeMarkReady(conn, state);
        break;
      }

      case 'search_query': {
        if (!state.ready) return; // refuse before handshake completes
        this.emit('search_request', {
          peerId: msg.queryId,
          queryId: msg.queryId,
          embedding: msg.embedding,
          limit: msg.limit,
          respondTo: state.peerId,
        });
        break;
      }

      case 'search_result': {
        if (!state.ready) return;
        this.emit('search_response', {
          queryId: msg.queryId,
          results: msg.results,
          peerId: state.peerId ?? 'unknown',
        });
        break;
      }

      case 'leave': {
        if (!state.ready) return;
        if (msg.peerId !== state.peerId) return; // can only evict own id
        const registered = this.peers.get(msg.peerId);
        if (registered && registered.conn === conn) {
          this.peers.delete(msg.peerId);
          this.emit('peer_left', { peerId: msg.peerId });
        }
        break;
      }

      case 'challenge':
      case 'ready':
        // Reserved for future asymmetric variants; currently unused.
        break;

      case 'handshake':
        // v1 unsigned handshake — log and ignore so the operator can spot it.
        console.warn(
          `[federation] Rejected v1 handshake from peerId=${state.peerId ?? 'unknown'}. ` +
          `Peer must upgrade to v2 (Ed25519).`,
        );
        break;
    }
  }

  private maybeMarkReady(conn: PeerConnection, state: ConnectionState) {
    if (state.ready) return;
    if (!state.weResponded || !state.peerVerified) return;
    if (!state.peerId || !state.pendingPeerInfo) return;
    state.ready = true;
    if (state.handshakeTimer) {
      clearTimeout(state.handshakeTimer);
      state.handshakeTimer = null;
    }
    this.peers.set(state.peerId, { info: state.pendingPeerInfo, conn });
    this.emit('peer_joined', state.pendingPeerInfo);
  }
}
