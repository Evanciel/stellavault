import { describe, it, expect } from 'vitest';
import { contentHash, ingestTypeFor, sourceLabel, incrementalCentroid } from '../src/main/orchestration/capture-helpers.js';

describe('contentHash', () => {
  it('is stable + whitespace/case-insensitive', () => {
    expect(contentHash('Hello  World')).toBe(contentHash('hello world'));
  });
  it('differs for different content', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });
  it('is 32 hex chars', () => {
    expect(contentHash('x')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('ingestTypeFor', () => {
  it('maps file source-formats; url/text pass through', () => {
    expect(ingestTypeFor('file', 'pdf')).toBe('pdf');
    expect(ingestTypeFor('file', 'docx')).toBe('docx');
    expect(ingestTypeFor('file', 'xlsx')).toBe('xlsx');
    expect(ingestTypeFor('file', 'csv')).toBe('text');   // non-binary → text
    expect(ingestTypeFor('url')).toBe('url');
    expect(ingestTypeFor('text')).toBe('text');
  });
});

describe('sourceLabel', () => {
  it('labels mcp + drop variants', () => {
    expect(sourceLabel({ source: 'mcp', sourceMeta: { client: 'claude' } })).toBe('mcp:claude');
    expect(sourceLabel({ source: 'mcp' })).toBe('mcp:agent');
    expect(sourceLabel({ source: 'drop', sourceMeta: { fileName: 'a.pdf' } })).toBe('drop:a.pdf');
    expect(sourceLabel({ source: 'drop' })).toBe('drop');
  });
});

describe('incrementalCentroid', () => {
  it('empty old → copy of v (first member)', () => {
    const v = [1, 2];
    const out = incrementalCentroid([], v, 0);
    expect(out).toEqual([1, 2]);
    expect(out).not.toBe(v); // copy, not alias
  });
  it('moves toward v by 1/(count+1)', () => {
    // old=[0,0], v=[10,0], count=1 → n=2 → [0+(10-0)/2, 0] = [5,0]
    expect(incrementalCentroid([0, 0], [10, 0], 1)).toEqual([5, 0]);
  });
  it('does not mutate the old centroid', () => {
    const old = [2, 2];
    incrementalCentroid(old, [4, 4], 1);
    expect(old).toEqual([2, 2]);
  });
});
