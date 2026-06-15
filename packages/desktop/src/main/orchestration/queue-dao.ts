// Persisted, crash-safe capture queue + dedup hash (Design §6.1 / [RESOLVED-Engine]).
// Serial FIFO over a better-sqlite3 handle (the index DB). Survives restart: on boot the
// engine calls requeueStuck() so any 'processing' rows return to 'queued' (at-least-once;
// the dedup hash makes a re-run a no-op). Pure data-access — the engine worker drives it.

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CaptureOutcome, CaptureRequest, QueueItem, QueueStatus } from './types.js';

type DB = Database.Database;

export function ensureQueueTables(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS capture_queue (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      title TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL,
      source_meta TEXT NOT NULL DEFAULT '{}',
      stage_hint TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      result TEXT,
      enqueued_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_capture_queue_status ON capture_queue(status, enqueued_at);

    CREATE TABLE IF NOT EXISTS capture_hash (
      hash TEXT PRIMARY KEY,
      saved_to TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

interface QueueRow {
  id: string; kind: string; payload: string; title: string | null; tags: string;
  source: string; source_meta: string; stage_hint: string | null; status: string;
  result: string | null; enqueued_at: string; updated_at: string;
}
function rowToItem(r: QueueRow): QueueItem {
  return {
    id: r.id, kind: r.kind as QueueItem['kind'], payload: r.payload,
    title: r.title ?? undefined, tags: JSON.parse(r.tags) as string[],
    source: r.source as QueueItem['source'], sourceMeta: JSON.parse(r.source_meta) as QueueItem['sourceMeta'],
    stageHint: (r.stage_hint as QueueItem['stageHint']) ?? undefined,
    status: r.status as QueueStatus, result: r.result ? (JSON.parse(r.result) as CaptureOutcome) : undefined,
    enqueuedAt: r.enqueued_at, updatedAt: r.updated_at,
  };
}

export interface QueueDao {
  enqueue(req: CaptureRequest, id?: string): string;
  nextQueued(): QueueItem | null;
  get(id: string): QueueItem | null;
  setStatus(id: string, status: QueueStatus, result?: CaptureOutcome): void;
  depth(): number;
  requeueStuck(): number;            // processing → queued (boot recovery); returns count
  listRecent(limit?: number): QueueItem[];
  // dedup hash
  hashGet(hash: string): string | null;
  hashPut(hash: string, savedTo: string): void;
}

export function createQueueDao(db: DB, now: () => string = () => new Date().toISOString()): QueueDao {
  ensureQueueTables(db);
  return {
    enqueue(req, id = randomUUID()): string {
      db.prepare(`
        INSERT INTO capture_queue (id,kind,payload,title,tags,source,source_meta,stage_hint,status,enqueued_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?, 'queued', ?, ?)
      `).run(
        id, req.kind, req.payload, req.title ?? null, JSON.stringify(req.tags ?? []),
        req.source, JSON.stringify(req.sourceMeta ?? {}), req.stageHint ?? null, now(), now(),
      );
      return id;
    },
    nextQueued(): QueueItem | null {
      const r = db.prepare("SELECT * FROM capture_queue WHERE status='queued' ORDER BY enqueued_at ASC, id ASC LIMIT 1").get() as QueueRow | undefined;
      return r ? rowToItem(r) : null;
    },
    get(id): QueueItem | null {
      const r = db.prepare('SELECT * FROM capture_queue WHERE id=?').get(id) as QueueRow | undefined;
      return r ? rowToItem(r) : null;
    },
    setStatus(id, status, result): void {
      db.prepare('UPDATE capture_queue SET status=?, result=?, updated_at=? WHERE id=?')
        .run(status, result ? JSON.stringify(result) : null, now(), id);
    },
    depth(): number {
      return (db.prepare("SELECT COUNT(*) AS n FROM capture_queue WHERE status='queued'").get() as { n: number }).n;
    },
    requeueStuck(): number {
      const info = db.prepare("UPDATE capture_queue SET status='queued', updated_at=? WHERE status='processing'").run(now());
      return info.changes;
    },
    listRecent(limit = 50): QueueItem[] {
      return (db.prepare('SELECT * FROM capture_queue ORDER BY enqueued_at DESC LIMIT ?').all(limit) as QueueRow[]).map(rowToItem);
    },
    hashGet(hash): string | null {
      const r = db.prepare('SELECT saved_to FROM capture_hash WHERE hash=?').get(hash) as { saved_to: string } | undefined;
      return r ? r.saved_to : null;
    },
    hashPut(hash, savedTo): void {
      db.prepare('INSERT INTO capture_hash (hash,saved_to,created_at) VALUES (?,?,?) ON CONFLICT(hash) DO UPDATE SET saved_to=excluded.saved_to')
        .run(hash, savedTo, now());
    },
  };
}
