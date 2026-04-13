import { describe, it, expect } from 'vitest';
import { cosineSimilarity, dotProduct, normalizeVector, euclideanDist } from '../src/utils/math.js';

// Synthetic vector generator
function randomVector(dims: number): number[] {
  return Array.from({ length: dims }, () => Math.random() - 0.5);
}

describe('utils/math', () => {
  it('cosineSimilarity — identical vectors → 1.0', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('cosineSimilarity — orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('cosineSimilarity — opposite vectors → -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it('cosineSimilarity — length mismatch → 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('dotProduct — basic', () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32); // 4+10+18
  });

  it('normalizeVector — unit length', () => {
    const v = normalizeVector([3, 4]);
    const norm = Math.sqrt(v[0] ** 2 + v[1] ** 2);
    expect(norm).toBeCloseTo(1.0, 10);
  });

  it('normalizeVector — zero vector stays zero', () => {
    const v = normalizeVector([0, 0, 0]);
    expect(v).toEqual([0, 0, 0]);
  });

  it('normalized dot product = cosine similarity', () => {
    const a = randomVector(384);
    const b = randomVector(384);
    const cosine = cosineSimilarity(a, b);
    const normA = normalizeVector([...a]);
    const normB = normalizeVector([...b]);
    const dot = dotProduct(normA, normB);
    expect(dot).toBeCloseTo(cosine, 6);
  });

  it('euclideanDist — zero for identical', () => {
    expect(euclideanDist([1, 2], [1, 2])).toBe(0);
  });

  it('euclideanDist — unit distance', () => {
    expect(euclideanDist([0, 0], [1, 0])).toBeCloseTo(1.0, 10);
  });
});

describe('performance benchmarks', () => {
  const DIMS = 384;
  const N = 500;
  const vectors = Array.from({ length: N }, () => randomVector(DIMS));

  it('cosine similarity 500x500 < 500ms', () => {
    const start = performance.now();
    let count = 0;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        cosineSimilarity(vectors[i], vectors[j]);
        count++;
      }
    }
    const elapsed = performance.now() - start;
    expect(count).toBe(N * (N - 1) / 2);
    expect(elapsed).toBeLessThan(500);
  });

  it('dot product 500x500 < 300ms (faster than cosine)', () => {
    const normalized = vectors.map(v => normalizeVector([...v]));
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        dotProduct(normalized[i], normalized[j]);
      }
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(300);
  });

  it('normalize 500 vectors < 10ms', () => {
    const vecs = vectors.map(v => [...v]);
    const start = performance.now();
    for (const v of vecs) normalizeVector(v);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });
});
