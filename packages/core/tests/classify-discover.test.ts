import { describe, it, expect } from 'vitest';
import { discoverCategories, topEntities, type DiscoverDoc } from '../src/intelligence/classify/discover.js';
import { DEFAULT_CLASSIFY_CONFIG, type Category } from '../src/intelligence/classify/types.js';

const NOW = '2026-06-15T00:00:00.000Z';
const cfg = DEFAULT_CLASSIFY_CONFIG;

function doc(id: string, embedding: number[], entities: string[], title = id): DiscoverDoc {
  return { id, embedding, entities, title };
}

const mlDocs = [
  doc('m1', [0.95, 0.05, 0, 0], ['model', 'ml']),
  doc('m2', [0.9, 0.1, 0.05, 0], ['model', 'training']),
  doc('m3', [0.92, 0, 0.08, 0], ['model', 'ml']),
];
const cookDocs = [
  doc('c1', [0.05, 0.95, 0, 0], ['recipe', 'food']),
  doc('c2', [0.1, 0.9, 0, 0.05], ['recipe', 'food']),
  doc('c3', [0, 0.92, 0.08, 0], ['recipe', 'cooking']),
];

describe('discoverCategories', () => {
  it('finds two emergent categories from two clean groups', () => {
    const { newCategories } = discoverCategories([...mlDocs, ...cookDocs], [], cfg, { nowIso: NOW, k: 2 });
    expect(newCategories).toHaveLength(2);
    expect(newCategories.map((c) => c.label).sort()).toEqual(['model', 'recipe']);
    for (const c of newCategories) {
      expect(c.origin).toBe('emergent');
      expect(c.memberCount).toBe(3);
      expect(c.centroid).toHaveLength(4);
      expect(c.keywords.length).toBeGreaterThan(0);
    }
  });

  it('excludes docs already owned by an existing category', () => {
    const existingMl: Category = {
      id: 'machine-learning', label: 'machine-learning', origin: 'user', centroid: [1, 0, 0, 0],
      memberCount: 10, keywords: ['model'], status: 'active', centroidVersion: 1, createdAt: NOW, updatedAt: NOW,
    };
    const { newCategories } = discoverCategories([...mlDocs, ...cookDocs], [existingMl], cfg, { nowIso: NOW, k: 1, minClusterSize: 3 });
    expect(newCategories).toHaveLength(1);            // only cook is unowned
    expect(newCategories[0].label).toBe('recipe');
    expect(newCategories[0].keywords).not.toContain('model');
  });

  it('returns nothing when fewer than minClusterSize unowned notes', () => {
    const { newCategories } = discoverCategories(mlDocs.slice(0, 2), [], cfg, { nowIso: NOW });
    expect(newCategories).toEqual([]);
  });

  it('avoids slug collision with existing category ids', () => {
    const existing: Category = {
      id: 'recipe', label: 'recipe', origin: 'user', centroid: [0, 0, 0, 1], // orthogonal → owns no cook doc
      memberCount: 1, keywords: [], status: 'active', centroidVersion: 1, createdAt: NOW, updatedAt: NOW,
    };
    const { newCategories } = discoverCategories(cookDocs, [existing], cfg, { nowIso: NOW, k: 1, minClusterSize: 3 });
    expect(newCategories).toHaveLength(1);
    expect(newCategories[0].id).toBe('recipe-2');   // 'recipe' taken → suffixed
    expect(newCategories[0].label).toBe('recipe');
  });
});

describe('topEntities', () => {
  it('orders by frequency, first-seen on ties', () => {
    expect(topEntities(['a', 'b', 'a', 'c', 'b', 'a'], 2)).toEqual(['a', 'b']);
  });
  it('ignores blanks and trims', () => {
    expect(topEntities(['  x ', '', 'x', '  '], 3)).toEqual(['x']);
  });
});
