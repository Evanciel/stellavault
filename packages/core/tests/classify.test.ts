import { describe, it, expect } from 'vitest';
import { classifyLocal, jaccard } from '../src/intelligence/classify/classify.js';
import { DEFAULT_CLASSIFY_CONFIG, type Category, type NoteCtx } from '../src/intelligence/classify/types.js';

// 4-dim centroids: dims 0..2 are real categories, dim 3 is an "unknown" axis so a
// note pointing into dim 3 is cold to ALL categories (cosine 0) — deterministic.
function cat(id: string, centroid: number[], extra: Partial<Category> = {}): Category {
  return {
    id, label: id, origin: 'emergent', centroid, memberCount: 1, keywords: [],
    status: 'active', centroidVersion: 1, createdAt: '', updatedAt: '', ...extra,
  };
}
function ctx(embedding: number[], extra: Partial<NoteCtx> = {}): NoteCtx {
  return { embedding, entities: [], tags: [], title: 't', ...extra };
}

const ml = cat('ml', [1, 0, 0, 0], { keywords: ['model', 'training'] });
const cooking = cat('cooking', [0, 1, 0, 0]);
const finance = cat('finance', [0, 0, 1, 0]);
const cats = [ml, cooking, finance];
const cfg = DEFAULT_CLASSIFY_CONFIG;

describe('classifyLocal', () => {
  it('clear winner → auto band, high confidence, embedding method', () => {
    const r = classifyLocal(ctx([0.98, 0.1, 0.05, 0]), cats, cfg);
    expect(r.categoryId).toBe('ml');
    expect(r.band).toBe('auto');
    expect(r.method).toBe('embedding');
    expect(r.confidence).toBeGreaterThanOrEqual(cfg.tau.auto);
    expect(r.alternatives[0].id).toBe('ml');
  });

  it('ambiguous (tie between two) → not auto', () => {
    const r = classifyLocal(ctx([0.7, 0.7, 0, 0]), cats, cfg);
    expect(r.band).not.toBe('auto');
    expect(r.confidence).toBeLessThan(cfg.tau.auto);
  });

  it('cold (orthogonal to all centroids) → review-cold, categoryId null', () => {
    const r = classifyLocal(ctx([0, 0, 0, 1]), cats, cfg);
    expect(r.categoryId).toBeNull();
    expect(r.band).toBe('review-cold');
  });

  it('hard rule (tag) beats embedding → rule method, confidence 1', () => {
    const archive = cat('archive', [0, 0, 0, 0.001], { rules: [{ kind: 'tag', value: 'archive' }] });
    const r = classifyLocal(ctx([0.98, 0.1, 0, 0], { tags: ['Archive'] }), [ml, archive], cfg);
    expect(r.categoryId).toBe('archive');
    expect(r.method).toBe('rule');
    expect(r.confidence).toBe(1);
    expect(r.band).toBe('auto');
  });

  it('frontmatterKey rule with key=value (centroid orthogonal to the note so only the rule can match)', () => {
    const adr = cat('adr', [1, 0, 0, 0], { rules: [{ kind: 'frontmatterKey', value: 'type=decision' }] });
    // note embedding [0,0,0,1] is orthogonal to adr's centroid → embedding alone never assigns it.
    const hit = classifyLocal(ctx([0, 0, 0, 1], { frontmatter: { type: 'decision' } }), [adr], cfg);
    expect(hit.categoryId).toBe('adr');
    expect(hit.method).toBe('rule');
    const miss = classifyLocal(ctx([0, 0, 0, 1], { frontmatter: { type: 'note' } }), [adr], cfg);
    expect(miss.categoryId).toBeNull();
  });

  it('no categories at all → review-cold null (everything is a new-category candidate)', () => {
    const r = classifyLocal(ctx([1, 0, 0, 0]), [], cfg);
    expect(r.categoryId).toBeNull();
    expect(r.band).toBe('review-cold');
    expect(r.alternatives).toHaveLength(0);
  });

  it('lexical bonus lifts confidence when entities match keywords', () => {
    const base = classifyLocal(ctx([0.62, 0.5, 0, 0]), cats, cfg);
    const boosted = classifyLocal(ctx([0.62, 0.5, 0, 0], { entities: ['model', 'training'] }), cats, cfg);
    expect(boosted.confidence).toBeGreaterThan(base.confidence);
  });
});

describe('jaccard', () => {
  it('is case-insensitive and order-independent', () => {
    expect(jaccard(['Model', 'Training'], ['training', 'model'])).toBe(1);
  });
  it('empty sets → 0', () => {
    expect(jaccard([], ['x'])).toBe(0);
    expect(jaccard(['x'], [])).toBe(0);
  });
  it('partial overlap', () => {
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 5);
  });
});
