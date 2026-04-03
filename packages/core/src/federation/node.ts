// Design Ref: §4 — FederationNode (Hyperswarm P2P)
// Plan SC: SC1 (2노드 연결), SC5 (오프라인 정상)

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getOrCreateIdentity, type NodeIdentity } from './identity.js';
import type { PeerInfo, FederationMessage } from './types.js';

const FEDERATION_TOPIC = createHash('sha256').update('stellavault-federation-v1').digest();

export class FederationNode extends EventEmitter {
  private swarm: any = null;
  private identity: NodeIdentity;
  private peers = new Map<string, { info: PeerInfo; conn: any }>();
  private running = false;
  private documentCount = 0;
  private topTopics: string[] = [];

  constructor(displayName?: string) {
    super();
    this.identity = getOrCreateIdentity(displayName);
  }

  get peerId(): string { return this.identity.peerId; }
  get displayName(): string { return this.identity.displayName; }
  get peerCount(): number { return this.peers.size; }
  get isRunning(): boolean { return this.running; }

  setLocalStats(documentCount: number, topTopics: string[]) {
    this.documentCount = documentCount;
    this.topTopics = topTopics.slice(0, 5);
  }

  // Design Ref: §4 — join()
  async join(): Promise<void> {
    if (this.running) return;

    const Hyperswarm = (await import('hyperswarm')).default;
    this.swarm = new Hyperswarm({ maxPeers: 50 });

    this.swarm.on('connection', (conn: any, _info: any) => {
      this.handleConnection(conn);
    });

    const discovery = this.swarm.join(FEDERATION_TOPIC, { server: true, client: true });
    await discovery.flushed();

    this.running = true;
    this.emit('joined', { peerId: this.peerId, topic: FEDERATION_TOPIC.toString('hex').slice(0, 16) });
  }

  // Design Ref: §4 — joinDirect() 수동 IP 폴백
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
        this.sendMessage(peer.conn, { type: 'leave', peerId: this.peerId });
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

  // 피어에게 검색 쿼리 전송 (FederatedSearch에서 사용)
  sendSearchQuery(peerId: string, queryId: string, embedding: number[], limit: number): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.sendMessage(peer.conn, { type: 'search_query', queryId, embedding, limit });
  }

  // 피어에게 검색 결과 응답 (FederatedSearch에서 사용)
  sendSearchResult(peerId: string, queryId: string, results: Array<{ title: string; similarity: number; snippet: string }>): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.sendMessage(peer.conn, { type: 'search_result', queryId, results });
  }

  // --- Private ---

  private handleConnection(conn: any) {
    // 핸드셰이크 전송
    this.sendMessage(conn, {
      type: 'handshake',
      peerId: this.peerId,
      displayName: this.identity.displayName,
      version: '0.1.0',
      documentCount: this.documentCount,
      topTopics: this.topTopics,
    });

    let buffer = '';
    const MAX_BUFFER = 1024 * 1024; // HIGH-04: 1MB 버퍼 제한 (OOM 방지)
    const MAX_MESSAGE = 64 * 1024;  // 개별 메시지 64KB 제한

    conn.on('data', (data: Buffer) => {
      buffer += data.toString();

      // 버퍼 크기 초과 시 연결 종료
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
        if (line.length > MAX_MESSAGE) continue; // 초대형 메시지 무시
        try {
          const msg: FederationMessage = JSON.parse(line);
          this.handleMessage(conn, msg);
        } catch { /* malformed — ignore */ }
      }
    });

    conn.on('close', () => {
      for (const [peerId, peer] of this.peers) {
        if (peer.conn === conn) {
          this.peers.delete(peerId);
          this.emit('peer_left', { peerId });
          break;
        }
      }
    });

    conn.on('error', () => { /* swallow */ });
  }

  private handleMessage(conn: any, msg: FederationMessage) {
    switch (msg.type) {
      case 'handshake': {
        const peerInfo: PeerInfo = {
          peerId: msg.peerId,
          displayName: msg.displayName,
          documentCount: msg.documentCount,
          topTopics: msg.topTopics ?? [],
          joinedAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        };
        this.peers.set(msg.peerId, { info: peerInfo, conn });
        this.emit('peer_joined', peerInfo);
        break;
      }

      case 'search_query': {
        // Design Ref: §5 — 검색 요청 수신
        this.emit('search_request', {
          peerId: msg.queryId, // queryId를 추적용으로 사용
          queryId: msg.queryId,
          embedding: msg.embedding,
          limit: msg.limit,
          // respond 함수: 호출 측에서 사용
          respondTo: (() => {
            // 어느 피어가 보냈는지 찾기
            for (const [pid, peer] of this.peers) {
              if (peer.conn === conn) return pid;
            }
            return null;
          })(),
        });
        break;
      }

      case 'search_result': {
        // FederatedSearch가 이벤트로 수신
        this.emit('search_response', {
          queryId: msg.queryId,
          results: msg.results,
          peerId: (() => {
            for (const [pid, peer] of this.peers) {
              if (peer.conn === conn) return pid;
            }
            return 'unknown';
          })(),
        });
        break;
      }

      case 'leave': {
        this.peers.delete(msg.peerId);
        this.emit('peer_left', { peerId: msg.peerId });
        break;
      }
    }
  }

  // Design Ref: §7 — JSON + newline delimiter
  private sendMessage(conn: any, msg: FederationMessage) {
    try {
      conn.write(JSON.stringify(msg) + '\n');
    } catch { /* connection may be closed */ }
  }
}
