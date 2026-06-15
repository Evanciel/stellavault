import { describe, it, expect } from 'vitest';
import { cosineKMeans, meanVector } from '../src/intelligence/classify/cluster.js';

describe('cosineKMeans', () => {
  it('separates two well-separated groups (k=2)', () => {
    const A = [[0.95, 0.05, 0, 0], [0.9, 0.1, 0.05, 0], [0.92, 0, 0.08, 0]];
    const B = [[0.05, 0.95, 0, 0], [0.1, 0.9, 0, 0.05], [0, 0.92, 0.08, 0]];
    const a = cosineKMeans([...A, ...B], 2);
    expect(new Set(a.slice(0, 3)).size).toBe(1); // group A → one cluster
    expect(new Set(a.slice(3)).size).toBe(1);    // group B → one cluster
    expect(a[0]).not.toBe(a[3]);                 // different clusters
  });

  it('does not mutate input vectors', () => {
    const v = [[3, 0, 0], [0, 3, 0]];
    const copy = JSON.parse(JSON.stringify(v));
    cosineKMeans(v, 2);
    expect(v).toEqual(copy);
  });

  it('k is clamped to n; empty input → []', () => {
    expect(cosineKMeans([], 3)).toEqual([]);
    expect(cosineKMeans([[1, 0]], 5)).toEqual([0]);
  });
});

describe('meanVector', () => {
  it('averages componentwise', () => {
    expect(meanVector([[2, 4], [4, 8]])).toEqual([3, 6]);
  });
  it('empty → []', () => {
    expect(meanVector([])).toEqual([]);
  });
});
