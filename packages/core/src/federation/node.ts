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
// reuse one. LRU bounded at 1000 entries (~32KB).
const REPLAY_CACHE_LIMIT = 1000;

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

  /**
   * @param init Either a displayName string (legacy positional form) or an
   *             options object. Pass `{ identity }` to skip the on-disk identity
   *             load — useful for tests that need many ephemeral peers.
   */
  constructor(init?: string | { displayName?: string; identity?: NodeIdentity }) {
    super();
    if (init && typeof init === 'object') {
      this.identity = init.identity ?? getOrCreateIdentity(init.displayName);
    } else {
      this.identity = getOrCreateIdentity(init);
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

  /** Stable JSON for signing. Sorts top-level keys so both sides hash identically. */
  private canonicalize(payload: FederationMessage): string {
    return JSON.stringify(payload, Object.keys(payload).sort());
  }

  private sendSigned(conn: PeerConnection, payload: FederationMessage, includePublicKey = false) {
    try {
      const canonical = Buffer.from(this.canonicalize(payload), 'utf-8');
      const sig = signMessage(this.identity.secretKey, canonical);
      const envelope: SignedEnvelope = {
        payload,
        peerId: this.peerId,
        signature: sig.toString('hex'),
        ...(includePublicKey ? { publicKeyHex: this.identity.publicKey.toString('hex') } : {}),
      };
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
    };
    this.connStates.set(conn, state);

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
      this.connStates.delete(conn);
      if (st?.peerId && this.peers.get(st.peerId)?.conn === conn) {
        this.peers.delete(st.peerId);
        this.emit('peer_left', { peerId: st.peerId });
      }
    });

    conn.on('error', () => { /* swallow */ });
  }

  private dispatchLine(conn: PeerConnection, line: string) {
    let envelope: SignedEnvelope;
    try {
      envelope = JSON.parse(line) as SignedEnvelope;
    } catch { return; }

    if (!envelope || typeof envelope !== 'object') return;
    if (typeof envelope.peerId !== 'string') return;
    if (typeof envelope.signature !== 'string') return;
    if (!envelope.payload || typeof envelope.payload !== 'object') return;

    const state = this.connStates.get(conn);
    if (!state) return;

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

    // Verify the envelope signature.
    const canonical = Buffer.from(this.canonicalize(envelope.payload as FederationMessage), 'utf-8');
    let sigBuf: Buffer;
    try { sigBuf = Buffer.from(envelope.signature, 'hex'); } catch { return; }
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
    this.peers.set(state.peerId, { info: state.pendingPeerInfo, conn });
    this.emit('peer_joined', state.pendingPeerInfo);
  }
}
