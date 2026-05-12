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

describe('federation protocol v2 — post-review P2 hardening', () => {
  it('canonicalizes nested objects deterministically (recursive key sort)', async () => {
    // Two peers handshake successfully even though one builds an object with
    // a different top-level *insertion* order than the canonicalize() output.
    // If canonicalize only sorted the top level, search_result results' inner
    // objects could differ between sender/verifier and break signing.
    const nodeA = new FederationNode({ identity: generateEphemeralIdentity('A') });
    const nodeB = new FederationNode({ identity: generateEphemeralIdentity('B') });

    const { connA, connB } = makePair();
    const aReady = waitFor(nodeA, 'peer_joined');
    const bReady = waitFor(nodeB, 'peer_joined');
    injectConnection(nodeA, connA);
    injectConnection(nodeB, connB);
    await Promise.all([aReady, bReady]);

    // search_result has Array<{title, similarity, snippet}> — a nested-object
    // payload. Build it once on A and assert B accepts it (signature verifies
    // ⇔ canonical JSON identical on both sides).
    const recv = waitFor<{ results: Array<{ title: string }> }>(nodeB, 'search_response', 500);
    nodeA.sendSearchResult(nodeB.peerId, 'q-nested', [
      { title: 'doc-1', similarity: 0.91, snippet: 'first' },
      { title: 'doc-2', similarity: 0.82, snippet: 'second' },
    ]);
    const got = await recv;
    expect(got.results.map(r => r.title)).toEqual(['doc-1', 'doc-2']);
  });

  it('emits handshake_timeout and ends the connection if HELLO never arrives', async () => {
    const node = new FederationNode({
      identity: generateEphemeralIdentity('A'),
      handshakeTimeoutMs: 50, // very short for the test
    });

    // A connection that the peer never replies on. We track conn.end() calls.
    let endCalled = false;
    const out = new PassThrough();
    const inbound = new PassThrough();
    const conn: FakeConn = {
      write: (s) => { out.write(Buffer.from(s)); return true; },
      end: () => { endCalled = true; inbound.end(); },
      on: ((event: string, listener: (...a: unknown[]) => void) => {
        inbound.on(event, listener as never);
        return conn as unknown as EventEmitter;
      }) as EventEmitter['on'],
    };

    const timedOut = waitFor(node, 'handshake_timeout', 500);
    injectConnection(node, conn);
    await timedOut;

    expect(endCalled).toBe(true);
    expect(node.peerCount).toBe(0);
  });

  it('clears the handshake timer once the connection becomes ready', async () => {
    // Set a moderate timeout, complete the handshake before it fires, then
    // wait past the timeout window and confirm no handshake_timeout fired
    // and the peer is still registered.
    const nodeA = new FederationNode({
      identity: generateEphemeralIdentity('A'),
      handshakeTimeoutMs: 80,
    });
    const nodeB = new FederationNode({
      identity: generateEphemeralIdentity('B'),
      handshakeTimeoutMs: 80,
    });

    let timeoutFired = false;
    nodeA.on('handshake_timeout', () => { timeoutFired = true; });
    nodeB.on('handshake_timeout', () => { timeoutFired = true; });

    const { connA, connB } = makePair();
    const aReady = waitFor(nodeA, 'peer_joined');
    const bReady = waitFor(nodeB, 'peer_joined');
    injectConnection(nodeA, connA);
    injectConnection(nodeB, connB);
    await Promise.all([aReady, bReady]);

    // Wait well past the timeout
    await new Promise(r => setTimeout(r, 150));
    expect(timeoutFired).toBe(false);
    expect(nodeA.peerCount).toBe(1);
    expect(nodeB.peerCount).toBe(1);
  });

  it('drops a replayed post-handshake envelope (per-envelope nonce defence)', async () => {
    // Two nodes complete the handshake, A sends a search_query, then we
    // replay the exact bytes A sent to B. B must fire the first
    // search_request and drop the second (same envelope nonce).
    const nodeA = new FederationNode({ identity: generateEphemeralIdentity('A') });
    const nodeB = new FederationNode({ identity: generateEphemeralIdentity('B') });

    // Capture outbound bytes from A so we can replay them verbatim later.
    const aOut = new PassThrough();
    const bOut = new PassThrough();
    const aSent: string[] = [];
    const connA: FakeConn = {
      write: (s) => { aSent.push(s); aOut.write(Buffer.from(s, 'utf-8')); return true; },
      end: () => { aOut.end(); },
      on: ((event: string, listener: (...a: unknown[]) => void) => {
        bOut.on(event, listener as never);
        return connA as unknown as EventEmitter;
      }) as EventEmitter['on'],
    };
    const connB: FakeConn = {
      write: (s) => { bOut.write(Buffer.from(s, 'utf-8')); return true; },
      end: () => { bOut.end(); },
      on: ((event: string, listener: (...a: unknown[]) => void) => {
        aOut.on(event, listener as never);
        return connB as unknown as EventEmitter;
      }) as EventEmitter['on'],
    };

    const aReady = waitFor(nodeA, 'peer_joined');
    const bReady = waitFor(nodeB, 'peer_joined');
    injectConnection(nodeA, connA);
    injectConnection(nodeB, connB);
    await Promise.all([aReady, bReady]);

    // Count search_request emissions on B. Should be exactly 1 even though we
    // inject the captured envelope twice.
    let requests = 0;
    nodeB.on('search_request', () => { requests++; });

    // A sends a real, signed search_query to B.
    aSent.length = 0; // start capturing from this point
    nodeA.sendSearchQuery(nodeB.peerId, 'q-replay', new Array(384).fill(0.1), 5);

    // Wait a tick for B to process the original.
    await new Promise(r => setTimeout(r, 25));
    expect(requests).toBe(1);

    // Locate the search_query envelope A sent and replay it through B's
    // inbound stream (which is A's outbound stream from B's POV).
    const replayLine = aSent.find(s => s.includes('"search_query"'));
    expect(replayLine).toBeDefined();
    aOut.write(Buffer.from(replayLine!, 'utf-8'));

    await new Promise(r => setTimeout(r, 25));
    expect(requests).toBe(1); // still 1 — replay dropped
  });

  it('drops inbound envelopes once the per-peer rate limit is exceeded', async () => {
    // Tiny bucket so flooding trips it immediately. peerCount stays 0 after a
    // burst because every signed envelope past the bucket is silently dropped
    // (including the legitimate HELLO if you exceed the limit first).
    const node = new FederationNode({
      identity: generateEphemeralIdentity('A'),
      handshakeTimeoutMs: 0,           // disable so it doesn't interfere
      rateLimitPerSec: 1,              // very slow refill
      rateLimitBurst: 2,               // only 2 envelopes admitted
    });

    let limited = 0;
    node.on('rate_limited', () => { limited++; });

    const out = new PassThrough();
    const inbound = new PassThrough();
    const conn: FakeConn = {
      write: (s) => { out.write(Buffer.from(s)); return true; },
      end: () => { /* noop */ },
      on: ((event: string, listener: (...a: unknown[]) => void) => {
        inbound.on(event, listener as never);
        return conn as unknown as EventEmitter;
      }) as EventEmitter['on'],
    };
    injectConnection(node, conn);

    // Flood 10 envelopes. They're all malformed (just `{}` after envelope
    // shape check) — admission control runs *first* in dispatchLine, so we
    // can count drops without needing valid signatures.
    const junk = JSON.stringify({ payload: {}, peerId: 'x', signature: '00' }) + '\n';
    for (let i = 0; i < 10; i++) inbound.write(Buffer.from(junk));

    await new Promise(r => setTimeout(r, 25));
    // With burst=2 and ~10 envelopes, ~8 should be limited.
    expect(limited).toBeGreaterThanOrEqual(5);
    expect(node.peerCount).toBe(0);
  });
});
