// Design Ref: §4 — Adaptive Search Tests
// Plan SC: SC-05 NDCG improvement, SC-06 regression 0

import { describe, it, expect } from 'vitest';
import { createAdaptiveSearch } from '../src/search/adaptive.js';
import type { SearchEngine } from '../src/search/index.js';
import type { SearchResult } from '../src/types/search.js';

function mockSearchEngine(results: SearchResult[]): SearchEngine {
  return {
    search: async () => [...results],
  };
}

function mockResult(id: string, score: number, tags: string[], filePath = ''): SearchResult {
  return {
    document: {
      id,
      filePath,
      title: `Doc ${id}`,
      content: '',
      frontmatter: {},
      tags,
      lastModified: new Date().toISOString(),
      contentHash: '',
    },
    chunk: {
      id: `chunk-${id}`,
      documentId: id,
      content: `Content of ${id}`,
      embedding: [],
      position: 0,
    },
    score,
    highlights: [],
  };
}

describe('Adaptive Search', () => {
  it('returns base results without context', async () => {
    const base = mockSearchEngine([
      mockResult('a', 0.9, ['react']),
      mockResult('b', 0.8, ['vue']),
    ]);
    const adaptive = createAdaptiveSearch({ baseSearch: base });
    const results = await adaptive.search({ query: 'test' });
    expect(results).toHaveLength(2);
    expect(results[0].document.id).toBe('a');
  });

  it('boosts results matching context tags', async () => {
    const base = mockSearchEngine([
      mockResult('a', 0.9, ['react']),
      mockResult('b', 0.85, ['vue', 'typescript']),
    ]);
    const adaptive = createAdaptiveSearch({ baseSearch: base });
    const results = await adaptive.search({
      query: 'framework',
      context: { recentDocTags: ['vue', 'typescript'] },
    });
    // b should be boosted due to tag overlap
    expect(results[0].document.id).toBe('b');
    expect(results[0].score).toBeGreaterThan(0.85);
  });

  it('boosts results in same directory', async () => {
    const base = mockSearchEngine([
      mockResult('a', 0.9, [], 'docs/api/auth.md'),
      mockResult('b', 0.85, [], 'docs/api/routes.md'),
    ]);
    const adaptive = createAdaptiveSearch({ baseSearch: base });
    const results = await adaptive.search({
      query: 'endpoints',
      context: { currentFilePath: 'docs/api/middleware.md' },
    });
    // Both should get proximity boost, b slightly more since closer score
    expect(results[0].score).toBeGreaterThan(0.9);
    expect(results[1].score).toBeGreaterThan(0.85);
  });

  it('accumulates search history across calls', async () => {
    const base = mockSearchEngine([
      mockResult('a', 0.9, ['react']),
    ]);
    const adaptive = createAdaptiveSearch({ baseSearch: base });

    // First search — no history
    await adaptive.search({ query: 'react hooks' });
    // Second search — has history but no tag context
    const results = await adaptive.search({ query: 'state management' });
    expect(results).toHaveLength(1);
  });

  it('handles empty results gracefully', async () => {
    const base = mockSearchEngine([]);
    const adaptive = createAdaptiveSearch({ baseSearch: base });
    const results = await adaptive.search({
      query: 'nonexistent',
      context: { recentDocTags: ['react'] },
    });
    expect(results).toHaveLength(0);
  });
});
