// Plan SC: docs/01-plan/features/federation-security-v2.plan.md §5 — protocol
// acceptance criteria (handshake completes, tampered/replayed messages drop,
// pre-handshake search refused).

import { describe, it, expect } from 'vitest';
import type { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { FederationNode } from '../src/federation/node.js';
import { generateEphemeralIdentity } from '../src/federation/identity.js';

interface FakeConn {
  write: (s: string) => boolean;
  end: () => void;
  on: EventEmitter['on'];
}

function makePair(): { connA: FakeConn; connB: FakeConn } {
  const aOut = new PassThrough(); // A writes here → B reads
  const bOut = new PassThrough(); // B writes here → A reads

  const connA: FakeConn = {
    write: (data) => { aOut.write(Buffer.from(data, 'utf-8')); return true; },
    end: () => { aOut.end(); },
    // A's "on data" subscribes to what B wrote
    on: ((event: string, listener: (...a: unknown[]) => void) => {
      bOut.on(event, listener as never);
      return connA as unknown as EventEmitter;
    }) as EventEmitter['on'],
  };
  const connB: FakeConn = {
    write: (data) => { bOut.write(Buffer.from(data, 'utf-8')); return true; },
    end: () => { bOut.end(); },
    on: ((event: string, listener: (...a: unknown[]) => void) => {
      aOut.on(event, listener as never);
      return connB as unknown as EventEmitter;
    }) as EventEmitter['on'],
  };

  return { connA, connB };
}

function waitFor<T = unknown>(node: FederationNode, event: string, timeoutMs = 1500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    node.on(event, (payload) => {
      clearTimeout(timer);
      resolve(payload as T);
    });
  });
}

function injectConnection(node: FederationNode, conn: FakeConn) {
  (node as unknown as { handleConnection: (c: unknown) => void }).handleConnection(conn);
}

describe('federation protocol v2 — mutual handshake', () => {
  it('completes the handshake and registers both peers symmetrically', async () => {
    const nodeA = new FederationNode({ identity: generateEphemeralIdentity('Alice') });
    const nodeB = new FederationNode({ identity: generateEphemeralIdentity('Bob') });
    nodeA.setLocalStats(42, ['ai', 'rust']);
    nodeB.setLocalStats(7, ['docs']);

    expect(nodeA.peerId).not.toBe(nodeB.peerId);

    const { connA, connB } = makePair();
    const joinedA = waitFor<{ peerId: string; displayName: string; documentCount: number; topTopics: string[] }>(nodeA, 'peer_joined');
    const joinedB = waitFor<{ peerId: string; displayName: string; documentCount: number; topTopics: string[] }>(nodeB, 'peer_joined');

    injectConnection(nodeA, connA);
    injectConnection(nodeB, connB);

    const [seenByA, seenByB] = await Promise.all([joinedA, joinedB]);

    expect(seenByA.peerId).toBe(nodeB.peerId);
    expect(seenByA.displayName).toBe('Bob');
    expect(seenByA.documentCount).toBe(7);
    expect(seenByA.topTopics).toEqual(['docs']);

    expect(seenByB.peerId).toBe(nodeA.peerId);
    expect(seenByB.displayName).toBe('Alice');
    expect(seenByB.documentCount).toBe(42);
    expect(seenByB.topTopics).toEqual(['ai', 'rust']);

    expect(nodeA.peerCount).toBe(1);
    expect(nodeB.peerCount).toBe(1);
  });

  it('lets search_query/search_result flow only after handshake completes', async () => {
    const nodeA = new FederationNode({ identity: generateEphemeralIdentity('A') });
    const nodeB = new FederationNode({ identity: generateEphemeralIdentity('B') });

    const { connA, connB } = makePair();
    const aReady = waitFor(nodeA, 'peer_joined');
    const bReady = waitFor(nodeB, 'peer_joined');
    injectConnection(nodeA, connA);
    injectConnection(nodeB, connB);
    await Promise.all([aReady, bReady]);

    const requestSeen = waitFor<{ queryId: string; embedding: number[] }>(nodeB, 'search_request', 500);
    nodeA.sendSearchQuery(nodeB.peerId, 'q-42', new Array(384).fill(0.1), 5);
    const req = await requestSeen;
    expect(req.queryId).toBe('q-42');
    expect(req.embedding.length).toBe(384);
  });
});

describe('federation protocol v2 — adversarial cases', () => {
  it('refuses search_query before the handshake completes (no signature, no peer key cached)', async () => {
    const node = new FederationNode({ identity: generateEphemeralIdentity('A') });

    let searchSeen = false;
    node.on('search_request', () => { searchSeen = true; });

    // Drive a one-sided "connection" where the remote never sends HELLO.
    const out = new PassThrough();
    const inbound = new PassThrough();
    const conn: FakeConn = {
      write: (s) => { out.write(Buffer.from(s)); return true; },
      end: () => { out.end(); },
      on: ((event: string, listener: (...a: unknown[]) => void) => {
        inbound.on(event, listener as never);
        return conn as unknown as EventEmitter;
      }) as EventEmitter['on'],
    };
    injectConnection(node, conn);

    // Naked search_query envelope with junk signature — must be dropped.
    const fakeEnvelope = {
      payload: { type: 'search_query', queryId: 'q1', embedding: new Array(384).fill(0), limit: 5 },
      peerId: 'deadbeef00000000',
      signature: '00'.repeat(64),
    };
    inbound.write(Buffer.from(JSON.stringify(fakeEnvelope) + '\n'));

    await new Promise(r => setTimeout(r, 25));
    expect(searchSeen).toBe(false);
    expect(node.peerCount).toBe(0);
  });

  it('rejects a HELLO whose peerId does not match its publicKey', async () => {
    const nodeA = new FederationNode({ identity: generateEphemeralIdentity('A') });
    const realB = generateEphemeralIdentity('B');

    let aJoined = false;
    nodeA.on('peer_joined', () => { aJoined = true; });

    const inbound = new PassThrough();
    const conn: FakeConn = {
      write: () => true,
      end: () => { /* noop */ },
      on: ((event: string, listener: (...a: unknown[]) => void) => {
        inbound.on(event, listener as never);
        return conn as unknown as EventEmitter;
      }) as EventEmitter['on'],
    };
    injectConnection(nodeA, conn);

    // Claim an arbitrary peerId while presenting B's real publicKey. The peerId
    // derivation check must catch this before any signature work.
    const fakeEnvelope = {
      payload: {
        type: 'hello',
        peerId: 'aaaa1111bbbb2222',
        displayName: 'forger',
        version: '0.2.0',
        documentCount: 0,
        topTopics: [],
        nonce: '00'.repeat(32),
      },
      peerId: 'aaaa1111bbbb2222',
      publicKeyHex: realB.publicKey.toString('hex'),
      signature: '00'.repeat(64),
    };
    inbound.write(Buffer.from(JSON.stringify(fakeEnvelope) + '\n'));

    await new Promise(r => setTimeout(r, 25));
    expect(aJoined).toBe(false);
    expect(nodeA.peerCount).toBe(0);
  });

  it('rejects a HELLO with a forged signature for a valid peerId/publicKey pair', async () => {
    const nodeA = new FederationNode({ identity: generateEphemeralIdentity('A') });
    const realB = generateEphemeralIdentity('B');

    let aJoined = false;
    nodeA.on('peer_joined', () => { aJoined = true; });

    const inbound = new PassThrough();
    const conn: FakeConn = {
      write: () => true,
      end: () => { /* noop */ },
      on: ((event: string, listener: (...a: unknown[]) => void) => {
        inbound.on(event, listener as never);
        return conn as unknown as EventEmitter;
      }) as EventEmitter['on'],
    };
    injectConnection(nodeA, conn);

    // peerId derives from publicKey correctly, but signature is zeros → must
    // fail Ed25519 verification.
    const fakeEnvelope = {
      payload: {
        type: 'hello',
        peerId: realB.peerId,
        displayName: 'Bob',
        version: '0.2.0',
        documentCount: 0,
        topTopics: [],
        nonce: '00'.repeat(32),
      },
      peerId: realB.peerId,
      publicKeyHex: realB.publicKey.toString('hex'),
      signature: '00'.repeat(64),
    };
    inbound.write(Buffer.from(JSON.stringify(fakeEnvelope) + '\n'));

    await new Promise(r => setTimeout(r, 25));
    expect(aJoined).toBe(false);
    expect(nodeA.peerCount).toBe(0);
  });
});
