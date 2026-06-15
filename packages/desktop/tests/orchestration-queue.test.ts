import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createQueueDao, type QueueDao } from '../src/main/orchestration/queue-dao.js';
import type { CaptureRequest } from '../src/main/orchestration/types.js';

function req(over: Partial<CaptureRequest> = {}): CaptureRequest {
  return { kind: 'text', payload: 'hello', source: 'drop', ...over };
}

describe('QueueDao', () => {
  let db: Database.Database;
  let q: QueueDao;
  let t = 0;
  beforeEach(() => {
    db = new Database(':memory:');
    t = 0;
    // monotonic injected clock so FIFO ordering by enqueued_at is deterministic
    q = createQueueDao(db, () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`);
  });

  it('FIFO: nextQueued returns the oldest queued item', () => {
    const a = q.enqueue(req({ payload: 'a' }));
    const b = q.enqueue(req({ payload: 'b' }));
    expect(q.depth()).toBe(2);
    expect(q.nextQueued()!.id).toBe(a);
    q.setStatus(a, 'processing');
    expect(q.nextQueued()!.id).toBe(b); // a no longer queued
    expect(q.depth()).toBe(1);
  });

  it('round-trips request fields incl. tags + sourceMeta + stageHint', () => {
    const id = q.enqueue(req({
      kind: 'file', payload: '/tmp/x', title: 'T', tags: ['a', 'b'],
      source: 'mcp', sourceMeta: { client: 'claude' }, stageHint: 'literature',
    }));
    const item = q.get(id)!;
    expect(item.kind).toBe('file');
    expect(item.tags).toEqual(['a', 'b']);
    expect(item.sourceMeta).toEqual({ client: 'claude' });
    expect(item.stageHint).toBe('literature');
    expect(item.status).toBe('queued');
  });

  it('setStatus stores a terminal CaptureOutcome', () => {
    const id = q.enqueue(req());
    q.setStatus(id, 'done', { status: 'created', savedTo: '/v/n.md', indexed: true });
    const item = q.get(id)!;
    expect(item.status).toBe('done');
    expect(item.result).toEqual({ status: 'created', savedTo: '/v/n.md', indexed: true });
  });

  it('requeueStuck resets processing → queued (crash recovery)', () => {
    const id = q.enqueue(req());
    q.setStatus(id, 'processing');
    expect(q.depth()).toBe(0);
    expect(q.requeueStuck()).toBe(1);
    expect(q.depth()).toBe(1);
    expect(q.nextQueued()!.id).toBe(id);
  });

  it('dedup hash get/put (upsert)', () => {
    expect(q.hashGet('h1')).toBeNull();
    q.hashPut('h1', '/v/dup.md');
    expect(q.hashGet('h1')).toBe('/v/dup.md');
    q.hashPut('h1', '/v/dup2.md');
    expect(q.hashGet('h1')).toBe('/v/dup2.md');
  });

  it('listRecent is newest-first', () => {
    const a = q.enqueue(req({ payload: 'a' }));
    const b = q.enqueue(req({ payload: 'b' }));
    expect(q.listRecent().map((x) => x.id)).toEqual([b, a]);
  });
});
