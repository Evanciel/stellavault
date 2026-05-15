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

// Codex 2026-05-15: in-process singleflight — 동시 cache miss / forceRefresh
// 가 같은 graph build 를 중복 호출하지 않도록 inflight Promise 공유.
let inflightCompute: Promise<GapReport> | null = null;

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
 *  so concurrent callers share one graph-build (30s+) instead of duplicating. */
export async function computeAndCacheGaps(store: VectorStore, db: Database): Promise<GapReport> {
  if (inflightCompute) return inflightCompute;
  inflightCompute = (async () => {
    try {
      ensureGapCacheTable(db);
      const report = await detectKnowledgeGaps(store);
      const payload = JSON.stringify(report);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO gap_cache (id, payload, version, computed_at) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, version = excluded.version, computed_at = excluded.computed_at`,
      ).run(payload, CACHE_VERSION, now);
      return report;
    } finally {
      inflightCompute = null;
    }
  })();
  return inflightCompute;
}

/** Drop cache row — caller should invoke after reindex to force fresh compute
 *  on next request. Idempotent. */
export function invalidateGapCache(db: Database): void {
  try {
    ensureGapCacheTable(db);
    db.prepare('DELETE FROM gap_cache WHERE id = 1').run();
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
