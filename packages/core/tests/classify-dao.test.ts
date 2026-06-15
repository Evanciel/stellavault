import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createClassifyDao, type ClassifyDao } from '../src/intelligence/classify/dao.js';
import type { Category, JournalEntry } from '../src/intelligence/classify/types.js';

function mkCat(id: string, over: Partial<Category> = {}): Category {
  const now = new Date().toISOString();
  return {
    id, label: id, origin: 'emergent', centroid: [0.1, 0.2, 0.3], memberCount: 1,
    keywords: ['k1'], status: 'active', centroidVersion: 1, createdAt: now, updatedAt: now, ...over,
  };
}
function mkJournal(id: string, over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id, notePath: `/v/00_Inbox/${id}.md`, categoryId: null, confidence: 0.4, method: 'embedding',
    band: 'review-cold', status: 'review-pending', alternatives: [{ id: 'ml', sim: 0.4 }],
    decidedAt: new Date().toISOString(), ...over,
  };
}

describe('ClassifyDao (categories)', () => {
  let db: Database.Database;
  let dao: ClassifyDao;
  beforeEach(() => { db = new Database(':memory:'); dao = createClassifyDao(db); });

  it('round-trips a category including the Float32 centroid + JSON fields', () => {
    dao.upsertCategory(mkCat('ml', {
      centroid: [0.5, -0.25, 0.125, 1], keywords: ['model', 'ai'],
      rules: [{ kind: 'tag', value: 'ml' }], pinned: true, threshold: 0.4,
    }));
    const got = dao.getCategory('ml')!;
    expect(got.label).toBe('ml');
    expect(got.pinned).toBe(true);
    expect(got.threshold).toBe(0.4);
    expect(got.keywords).toEqual(['model', 'ai']);
    expect(got.rules).toEqual([{ kind: 'tag', value: 'ml' }]);
    expect(got.centroid).toHaveLength(4);
    expect(got.centroid[0]).toBeCloseTo(0.5, 6);   // exact in Float32
    expect(got.centroid[1]).toBeCloseTo(-0.25, 6);
    expect(got.centroid[3]).toBeCloseTo(1, 6);
  });

  it('upsert overwrites; getActiveCategories excludes merged/archived', () => {
    dao.upsertCategory(mkCat('a'));
    dao.upsertCategory(mkCat('b'));
    dao.upsertCategory(mkCat('c', { status: 'archived' }));
    dao.setStatus('b', 'merged', 'a');
    expect(dao.getActiveCategories().map((c) => c.id)).toEqual(['a']);
    expect(dao.getCategory('b')!.mergedInto).toBe('a');
  });

  it('updateCentroid bumps centroid_version and member_count', () => {
    dao.upsertCategory(mkCat('a'));
    dao.updateCentroid('a', [9, 9, 9], 5);
    const got = dao.getCategory('a')!;
    expect(got.centroidVersion).toBe(2);
    expect(got.memberCount).toBe(5);
    expect(got.centroid[0]).toBeCloseTo(9, 5);
  });

  it('listCategories filters by origin, ordered by member_count', () => {
    dao.upsertCategory(mkCat('u1', { origin: 'user', memberCount: 2 }));
    dao.upsertCategory(mkCat('e1', { origin: 'emergent', memberCount: 9 }));
    dao.upsertCategory(mkCat('u2', { origin: 'user', memberCount: 5 }));
    expect(dao.listCategories('user').map((c) => c.id)).toEqual(['u2', 'u1']);
    expect(dao.listCategories().map((c) => c.id)[0]).toBe('e1');
  });
});

describe('ClassifyDao (journal / review queue)', () => {
  let db: Database.Database;
  let dao: ClassifyDao;
  beforeEach(() => { db = new Database(':memory:'); dao = createClassifyDao(db); });

  it('pending review excludes auto-filed; confirm removes from queue', () => {
    dao.appendJournal(mkJournal('j1'));
    dao.appendJournal(mkJournal('j2', { status: 'auto-filed', band: 'auto', categoryId: 'ml', confidence: 0.9 }));
    expect(dao.listPendingReview().map((p) => p.id)).toEqual(['j1']);

    dao.updateJournalStatus('j1', 'confirmed', { categoryId: 'ml', decidedBy: 'user' });
    expect(dao.listPendingReview()).toHaveLength(0);
    const j1 = dao.getJournal('j1')!;
    expect(j1.status).toBe('confirmed');
    expect(j1.categoryId).toBe('ml');
    expect(j1.decidedBy).toBe('user');
  });

  it('alternatives JSON round-trips', () => {
    dao.appendJournal(mkJournal('j', { categoryId: 'a', band: 'review', alternatives: [{ id: 'a', sim: 0.6 }, { id: 'b', sim: 0.55 }] }));
    expect(dao.getJournal('j')!.alternatives).toEqual([{ id: 'a', sim: 0.6 }, { id: 'b', sim: 0.55 }]);
  });

  it('updateJournalStatus preserves unspecified fields', () => {
    dao.appendJournal(mkJournal('j', { stage: 'fleeting', categoryId: 'x' }));
    dao.updateJournalStatus('j', 'skipped');
    const j = dao.getJournal('j')!;
    expect(j.status).toBe('skipped');
    expect(j.stage).toBe('fleeting');   // preserved
    expect(j.categoryId).toBe('x');     // preserved
  });
});
