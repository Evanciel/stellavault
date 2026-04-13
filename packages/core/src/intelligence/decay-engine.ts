// Design Ref: §3.2 — 감쇠 엔진 (DB 연동)
// Plan SC: SC-01, SC-02, SC-04

import type { Database } from 'better-sqlite3';
import type { DecayState, AccessEvent, DecayReport } from './types.js';
import {
  computeRetrievability,
  updateStability,
  estimateInitialStability,
  elapsedDays,
  FSRS_PARAMS,
} from './fsrs.js';

// SQLite row shapes returned by better-sqlite3 .get()/.all()
interface DecayStateRow { document_id: string; stability: number; difficulty: number; last_access: string; retrievability: number; updated_at: string }
interface DocTitleRow { id: string; title: string }
interface DocContentRow { content?: string }
interface ChunkCountRow { c: number }
interface ClusterDataRow { document_id: string; retrievability: number }
interface DocFilePathRow { file_path?: string }
interface DocInitRow { id: string; content?: string; last_modified?: string }
interface DecayJoinRow extends DecayStateRow { title: string }

export class DecayEngine {
  constructor(private db: Database) {
    this.ensureTables();
  }

  private ensureTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        access_type TEXT NOT NULL,
        accessed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_access_log_doc ON access_log(document_id);
      CREATE INDEX IF NOT EXISTS idx_access_log_time ON access_log(accessed_at);

      CREATE TABLE IF NOT EXISTS decay_state (
        document_id TEXT PRIMARY KEY,
        stability REAL NOT NULL DEFAULT 7.0,
        difficulty REAL NOT NULL DEFAULT 5.0,
        last_access TEXT NOT NULL,
        retrievability REAL NOT NULL DEFAULT 1.0,
        updated_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Record an access event and update decay state.
   */
  async recordAccess(event: AccessEvent): Promise<void> {
    const now = event.timestamp || new Date().toISOString();

    // Log the event
    this.db.prepare(
      'INSERT INTO access_log (document_id, access_type, accessed_at) VALUES (?, ?, ?)'
    ).run(event.documentId, event.type, now);

    // Get or create decay state
    const existing = this.db.prepare(
      'SELECT * FROM decay_state WHERE document_id = ?'
    ).get(event.documentId) as DecayStateRow | undefined;

    if (existing) {
      const elapsed = elapsedDays(existing.last_access, now);
      const currentR = computeRetrievability(existing.stability, elapsed);
      const newS = updateStability(existing.stability, existing.difficulty, currentR);

      this.db.prepare(`
        UPDATE decay_state SET stability = ?, last_access = ?, retrievability = 1.0, updated_at = ?
        WHERE document_id = ?
      `).run(newS, now, now, event.documentId);
    } else {
      // New document — estimate initial stability
      const doc = this.db.prepare('SELECT content FROM documents WHERE id = ?').get(event.documentId) as DocContentRow | undefined;
      const contentLen = doc?.content?.length ?? 500;
      const connCount = (this.db.prepare(
        'SELECT COUNT(*) as c FROM chunks WHERE document_id = ?'
      ).get(event.documentId) as ChunkCountRow | undefined)?.c ?? 1;
      const initS = estimateInitialStability(contentLen, connCount);

      this.db.prepare(`
        INSERT INTO decay_state (document_id, stability, difficulty, last_access, retrievability, updated_at)
        VALUES (?, ?, ?, ?, 1.0, ?)
      `).run(event.documentId, initS, FSRS_PARAMS.difficulty, now, now);
    }
  }

  /**
   * Batch compute retrievability for all documents.
   */
  async computeAll(): Promise<DecayReport> {
    const now = new Date().toISOString();

    // Initialize documents that don't have decay state yet
    await this.initializeNewDocuments();

    // Compute R for all
    const states = this.db.prepare('SELECT * FROM decay_state').all() as DecayStateRow[];
    const docs = this.db.prepare('SELECT id, title FROM documents').all() as DocTitleRow[];
    const titleMap = new Map(docs.map(d => [d.id, d.title]));

    const updated: DecayState[] = [];
    const updateStmt = this.db.prepare(
      'UPDATE decay_state SET retrievability = ?, updated_at = ? WHERE document_id = ?'
    );

    const tx = this.db.transaction(() => {
      for (const s of states) {
        const elapsed = elapsedDays(s.last_access, now);
        const r = computeRetrievability(s.stability, elapsed);
        updateStmt.run(r, now, s.document_id);
        updated.push({
          documentId: s.document_id,
          stability: s.stability,
          difficulty: s.difficulty,
          lastAccess: s.last_access,
          retrievability: r,
        });
      }
    });
    tx();

    // Build report
    const decaying = updated.filter(s => s.retrievability < 0.5);
    const critical = updated.filter(s => s.retrievability < 0.3);
    const avgR = updated.length > 0
      ? updated.reduce((sum, s) => sum + s.retrievability, 0) / updated.length
      : 1.0;

    // Top decaying (sorted by R ascending)
    const topDecaying = [...decaying]
      .sort((a, b) => a.retrievability - b.retrievability)
      .slice(0, 20)
      .map(s => ({
        ...s,
        title: titleMap.get(s.documentId) ?? s.documentId,
        daysSinceAccess: Math.round(elapsedDays(s.lastAccess, now)),
      }));

    // Cluster health
    const clusterData = this.db.prepare(`
      SELECT ds.document_id, ds.retrievability
      FROM decay_state ds
      JOIN documents d ON d.id = ds.document_id
    `).all() as ClusterDataRow[];

    const clusterHealth = this.computeClusterHealth(clusterData);

    return {
      totalDocuments: updated.length,
      decayingCount: decaying.length,
      criticalCount: critical.length,
      averageR: Math.round(avgR * 100) / 100,
      topDecaying,
      clusterHealth,
    };
  }

  private computeClusterHealth(data: ClusterDataRow[]): DecayReport['clusterHealth'] {
    const groups = new Map<string, number[]>();
    for (const row of data) {
      const doc = this.db.prepare('SELECT file_path FROM documents WHERE id = ?').get(row.document_id) as DocFilePathRow | undefined;
      const folder = doc?.file_path?.split('/')[0] ?? 'unknown';
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder)!.push(row.retrievability);
    }

    return [...groups.entries()]
      .map(([label, rs]) => ({
        label,
        avgR: Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) / 100,
        count: rs.length,
      }))
      .sort((a, b) => a.avgR - b.avgR);
  }

  /**
   * Get documents below decay threshold.
   */
  async getDecaying(threshold = 0.5, limit = 20): Promise<Array<DecayState & { title: string }>> {
    await this.computeAll(); // refresh R values

    const rows = this.db.prepare(`
      SELECT ds.*, d.title FROM decay_state ds
      JOIN documents d ON d.id = ds.document_id
      WHERE ds.retrievability < ?
      ORDER BY ds.retrievability ASC
      LIMIT ?
    `).all(threshold, limit) as DecayJoinRow[];

    return rows.map(r => ({
      documentId: r.document_id,
      stability: r.stability,
      difficulty: r.difficulty,
      lastAccess: r.last_access,
      retrievability: r.retrievability,
      title: r.title,
    }));
  }

  /**
   * Initialize decay state for documents that don't have one yet.
   */
  async initializeNewDocuments(): Promise<number> {
    const missing = this.db.prepare(`
      SELECT d.id, d.content, d.last_modified
      FROM documents d
      LEFT JOIN decay_state ds ON d.id = ds.document_id
      WHERE ds.document_id IS NULL
    `).all() as DocInitRow[];

    if (missing.length === 0) return 0;

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO decay_state (document_id, stability, difficulty, last_access, retrievability, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      for (const doc of missing) {
        const contentLen = doc.content?.length ?? 500;
        const initS = estimateInitialStability(contentLen, 1);
        const lastAccess = doc.last_modified || new Date().toISOString();
        const elapsed = elapsedDays(lastAccess);
        const r = computeRetrievability(initS, elapsed);
        insert.run(doc.id, initS, FSRS_PARAMS.difficulty, lastAccess, r, new Date().toISOString());
      }
    });
    tx();

    return missing.length;
  }
}
