// Gap detection cache (2026-05-15).
//
// detectKnowledgeGaps() 가 graph build + traversal 로 1215+ docs vault 에서
// 30s+ 걸려 MCP tool 호출 timeout. 결과는 거의 변하지 않으므로 (vault 가
// daily 갱신 + gap structure 는 slowly evolving) cache 가 정확히 fit.
//
// Schema: single-row table 'gap_cache' = { id, payload (JSON blob), computed_at }.
// id=1 always (cache singleton).
//
// Stale threshold default 6h (indexing 매일 → cache 6h 이내면 결과 안정).

import type { Database } from 'better-sqlite3';
import type { VectorStore } from '../store/types.js';
import { detectKnowledgeGaps, type GapReport } from './gap-detector.js';

const CACHE_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface GapCacheRow {
  id: number;
  payload: string;
  version: number;
  computed_at: string;
}

// Codex round 2-3: db-keyed singleflight + generation-bound inflight.
// inflight 에 generation 도 함께 저장해서 invalidate 후 들어온 caller 가
// stale promise 받지 않게 함 (round 3 stale-return race 해소).
const inflightByDb = new WeakMap<Database, { generation: number; promise: Promise<GapReport> }>();
const generationByDb = new WeakMap<Database, number>();
function bumpGeneration(db: Database): number {
  const cur = generationByDb.get(db) ?? 0;
  const next = cur + 1;
  generationByDb.set(db, next);
  return next;
}
function getGeneration(db: Database): number {
  return generationByDb.get(db) ?? 0;
}

export function ensureGapCacheTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gap_cache (
      id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      computed_at TEXT NOT NULL
    );
  `);
}

/** Read cached gap report if fresh enough. Returns null on miss/stale/error. */
export function readCachedGapReport(db: Database, maxAgeMs = DEFAULT_MAX_AGE_MS): GapReport | null {
  try {
    ensureGapCacheTable(db);
    const row = db.prepare('SELECT * FROM gap_cache WHERE id = 1').get() as GapCacheRow | undefined;
    if (!row) return null;
    if (row.version !== CACHE_VERSION) return null;
    const computedAt = new Date(row.computed_at).getTime();
    if (Number.isNaN(computedAt)) return null;
    if (Date.now() - computedAt > maxAgeMs) return null;
    return JSON.parse(row.payload) as GapReport;
  } catch {
    return null;
  }
}

/** Compute fresh gap report + persist to cache (atomic upsert). Singleflight
 *  per-db so concurrent callers share one graph-build (30s+) instead of
 *  duplicating. Generation token ensures stale write skip when invalidate
 *  happened mid-flight. */
export async function computeAndCacheGaps(store: VectorStore, db: Database): Promise<GapReport> {
  const currentGeneration = getGeneration(db);
  const existing = inflightByDb.get(db);
  // 같은 generation 의 inflight 면 share (round 2 singleflight).
  // 다른 generation (invalidate 이후 새 caller) → 새 compute 시작 (round 3
  // stale-return race 해소).
  if (existing && existing.generation === currentGeneration) {
    return existing.promise;
  }
  const startGeneration = currentGeneration;
  const promise = (async () => {
    try {
      ensureGapCacheTable(db);
      const report = await detectKnowledgeGaps(store);
      // write 직전 generation 비교 — invalidate 가 사이에 호출됐다면
      // generation bumped → write skip (fresh recompute 는 다음 호출에서).
      if (getGeneration(db) === startGeneration) {
        const payload = JSON.stringify(report);
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO gap_cache (id, payload, version, computed_at) VALUES (1, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, version = excluded.version, computed_at = excluded.computed_at`,
        ).run(payload, CACHE_VERSION, now);
      }
      return report;
    } finally {
      // 같은 generation 으로 등록된 entry 만 삭제 (newer caller 의 promise
      // 덮어쓰기 방지).
      const cur = inflightByDb.get(db);
      if (cur?.generation === startGeneration) inflightByDb.delete(db);
    }
  })();
  inflightByDb.set(db, { generation: startGeneration, promise });
  return promise;
}

/** Drop cache row + bump generation — in-flight compute 의 write 를 무효화.
 *  Caller should invoke after reindex. Idempotent. */
export function invalidateGapCache(db: Database): void {
  try {
    ensureGapCacheTable(db);
    db.prepare('DELETE FROM gap_cache WHERE id = 1').run();
    bumpGeneration(db); // in-flight compute 가 끝났을 때 stale write skip
  } catch { /* ignore */ }
}

/** Read cache or fall through to live compute + cache. Stable for tool handlers. */
export async function getGapReport(
  store: VectorStore,
  db: Database,
  opts: { maxAgeMs?: number; forceRefresh?: boolean } = {},
): Promise<{ report: GapReport; fromCache: boolean }> {
  if (!opts.forceRefresh) {
    const cached = readCachedGapReport(db, opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
    if (cached) return { report: cached, fromCache: true };
  }
  const fresh = await computeAndCacheGaps(store, db);
  return { report: fresh, fromCache: false };
}
