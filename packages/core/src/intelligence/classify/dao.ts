// Classification persistence — `categories` + `classify_journal` tables.
// Pure data-access over a better-sqlite3 handle (from store.getDb()), co-located with
// the index DB so journal writes are atomic with indexing. Idempotent DDL (CREATE IF
// NOT EXISTS) → survives reindex; the `_categories/*.md` registry is the portable
// authoritative mirror (sync is a P2 concern). Design Ref: §6.2 / §6.3 / [RESOLVED-F].

import type Database from 'better-sqlite3';
import type {
  Category, CategoryOrigin, CategoryRule, ClassifyBand, ClassifyMethod, JournalEntry, JournalStatus,
} from './types.js';

type DB = Database.Database;

// ── Float32 centroid (de)serialization (mirrors store's bufferToFloat32) ──
function centroidToBuf(c: number[]): Buffer {
  const f = new Float32Array(c);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}
function bufToCentroid(buf: Buffer | null | undefined): number[] {
  if (!buf || buf.byteLength === 0) return [];
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  return Array.from(f);
}

export function ensureClassifyTables(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      origin TEXT NOT NULL,
      centroid BLOB,
      member_count INTEGER NOT NULL DEFAULT 0,
      keywords TEXT NOT NULL DEFAULT '[]',
      folder TEXT,
      parent_id TEXT,
      rules TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      merged_into TEXT,
      threshold REAL,
      pinned INTEGER NOT NULL DEFAULT 0,
      centroid_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_categories_status ON categories(status);
    CREATE INDEX IF NOT EXISTS idx_categories_origin ON categories(origin);

    CREATE TABLE IF NOT EXISTS classify_journal (
      id TEXT PRIMARY KEY,
      note_path TEXT NOT NULL,
      category_id TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'embedding',
      band TEXT NOT NULL DEFAULT 'review-cold',
      status TEXT NOT NULL DEFAULT 'review-pending',
      alternatives TEXT NOT NULL DEFAULT '[]',
      stage TEXT,
      prev_path TEXT,
      source TEXT,
      decided_at TEXT NOT NULL,
      decided_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_journal_status ON classify_journal(status);
    CREATE INDEX IF NOT EXISTS idx_journal_path ON classify_journal(note_path);
  `);
}

interface CategoryRow {
  id: string; label: string; origin: string; centroid: Buffer | null;
  member_count: number; keywords: string; folder: string | null; parent_id: string | null;
  rules: string; status: string; merged_into: string | null; threshold: number | null;
  pinned: number; centroid_version: number; created_at: string; updated_at: string;
}
function rowToCategory(r: CategoryRow): Category {
  return {
    id: r.id, label: r.label, origin: r.origin as CategoryOrigin,
    centroid: bufToCentroid(r.centroid), memberCount: r.member_count,
    keywords: JSON.parse(r.keywords) as string[],
    folder: r.folder ?? undefined, parentId: r.parent_id ?? undefined,
    rules: JSON.parse(r.rules) as CategoryRule[],
    status: r.status as Category['status'], mergedInto: r.merged_into ?? undefined,
    threshold: r.threshold ?? undefined, pinned: r.pinned === 1,
    centroidVersion: r.centroid_version, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

interface JournalRow {
  id: string; note_path: string; category_id: string | null; confidence: number;
  method: string; band: string; status: string; alternatives: string; stage: string | null;
  prev_path: string | null; source: string | null; decided_at: string; decided_by: string | null;
}
function rowToJournal(r: JournalRow): JournalEntry {
  return {
    id: r.id, notePath: r.note_path, categoryId: r.category_id,
    confidence: r.confidence, method: r.method as ClassifyMethod, band: r.band as ClassifyBand,
    status: r.status as JournalStatus, alternatives: JSON.parse(r.alternatives) as { id: string; sim: number }[],
    stage: r.stage ?? undefined, prevPath: r.prev_path ?? undefined, source: r.source ?? undefined,
    decidedAt: r.decided_at, decidedBy: (r.decided_by as 'auto' | 'user' | null) ?? undefined,
  };
}

export interface ClassifyDao {
  // categories
  upsertCategory(c: Category): void;
  getCategory(id: string): Category | null;
  getActiveCategories(): Category[];
  listCategories(origin?: CategoryOrigin): Category[];
  updateCentroid(id: string, centroid: number[], memberCount: number): void;
  setStatus(id: string, status: Category['status'], mergedInto?: string): void;
  // journal / review queue
  appendJournal(e: JournalEntry): void;
  getJournal(id: string): JournalEntry | null;
  listPendingReview(limit?: number): JournalEntry[];
  updateJournalStatus(id: string, status: JournalStatus, patch?: Partial<Pick<JournalEntry, 'categoryId' | 'stage' | 'prevPath' | 'decidedBy'>>): void;
}

export function createClassifyDao(db: DB): ClassifyDao {
  ensureClassifyTables(db);
  const now = (): string => new Date().toISOString();

  const upsertStmt = db.prepare(`
    INSERT INTO categories (id,label,origin,centroid,member_count,keywords,folder,parent_id,rules,status,merged_into,threshold,pinned,centroid_version,created_at,updated_at)
    VALUES (@id,@label,@origin,@centroid,@member_count,@keywords,@folder,@parent_id,@rules,@status,@merged_into,@threshold,@pinned,@centroid_version,@created_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET
      label=@label, origin=@origin, centroid=@centroid, member_count=@member_count, keywords=@keywords,
      folder=@folder, parent_id=@parent_id, rules=@rules, status=@status, merged_into=@merged_into,
      threshold=@threshold, pinned=@pinned, centroid_version=@centroid_version, updated_at=@updated_at
  `);

  return {
    upsertCategory(c: Category): void {
      upsertStmt.run({
        id: c.id, label: c.label, origin: c.origin,
        centroid: c.centroid.length ? centroidToBuf(c.centroid) : null,
        member_count: c.memberCount, keywords: JSON.stringify(c.keywords ?? []),
        folder: c.folder ?? null, parent_id: c.parentId ?? null,
        rules: JSON.stringify(c.rules ?? []), status: c.status, merged_into: c.mergedInto ?? null,
        threshold: c.threshold ?? null, pinned: c.pinned ? 1 : 0,
        centroid_version: c.centroidVersion, created_at: c.createdAt || now(), updated_at: c.updatedAt || now(),
      });
    },
    getCategory(id: string): Category | null {
      const r = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
      return r ? rowToCategory(r) : null;
    },
    getActiveCategories(): Category[] {
      return (db.prepare("SELECT * FROM categories WHERE status = 'active'").all() as CategoryRow[]).map(rowToCategory);
    },
    listCategories(origin?: CategoryOrigin): Category[] {
      const rows = origin
        ? db.prepare('SELECT * FROM categories WHERE origin = ? ORDER BY member_count DESC').all(origin)
        : db.prepare('SELECT * FROM categories ORDER BY member_count DESC').all();
      return (rows as CategoryRow[]).map(rowToCategory);
    },
    updateCentroid(id: string, centroid: number[], memberCount: number): void {
      db.prepare('UPDATE categories SET centroid=?, member_count=?, centroid_version=centroid_version+1, updated_at=? WHERE id=?')
        .run(centroid.length ? centroidToBuf(centroid) : null, memberCount, now(), id);
    },
    setStatus(id: string, status: Category['status'], mergedInto?: string): void {
      db.prepare('UPDATE categories SET status=?, merged_into=?, updated_at=? WHERE id=?')
        .run(status, mergedInto ?? null, now(), id);
    },

    appendJournal(e: JournalEntry): void {
      db.prepare(`
        INSERT INTO classify_journal (id,note_path,category_id,confidence,method,band,status,alternatives,stage,prev_path,source,decided_at,decided_by)
        VALUES (@id,@note_path,@category_id,@confidence,@method,@band,@status,@alternatives,@stage,@prev_path,@source,@decided_at,@decided_by)
        ON CONFLICT(id) DO UPDATE SET
          category_id=@category_id, confidence=@confidence, method=@method, band=@band, status=@status,
          alternatives=@alternatives, stage=@stage, prev_path=@prev_path, source=@source, decided_at=@decided_at, decided_by=@decided_by
      `).run({
        id: e.id, note_path: e.notePath, category_id: e.categoryId, confidence: e.confidence,
        method: e.method, band: e.band, status: e.status, alternatives: JSON.stringify(e.alternatives ?? []),
        stage: e.stage ?? null, prev_path: e.prevPath ?? null, source: e.source ?? null,
        decided_at: e.decidedAt || now(), decided_by: e.decidedBy ?? null,
      });
    },
    getJournal(id: string): JournalEntry | null {
      const r = db.prepare('SELECT * FROM classify_journal WHERE id = ?').get(id) as JournalRow | undefined;
      return r ? rowToJournal(r) : null;
    },
    listPendingReview(limit = 100): JournalEntry[] {
      return (db.prepare("SELECT * FROM classify_journal WHERE status = 'review-pending' ORDER BY decided_at ASC LIMIT ?")
        .all(limit) as JournalRow[]).map(rowToJournal);
    },
    updateJournalStatus(id, status, patch): void {
      const cur = db.prepare('SELECT * FROM classify_journal WHERE id = ?').get(id) as JournalRow | undefined;
      if (!cur) return;
      db.prepare('UPDATE classify_journal SET status=?, category_id=?, stage=?, prev_path=?, decided_by=?, decided_at=? WHERE id=?')
        .run(
          status,
          patch?.categoryId !== undefined ? patch.categoryId : cur.category_id,
          patch?.stage !== undefined ? patch.stage : cur.stage,
          patch?.prevPath !== undefined ? patch.prevPath : cur.prev_path,
          patch?.decidedBy !== undefined ? patch.decidedBy : cur.decided_by,
          now(), id,
        );
    },
  };
}
