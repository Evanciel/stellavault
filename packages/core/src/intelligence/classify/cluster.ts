// Spherical (cosine) k-means for embedding clustering — emergent category discovery.
// Cosine is the right metric for our normalized text embeddings (the whole classifier
// uses cosine), unlike the Euclidean kMeans in api/graph-data.ts (2D/3D graph layout).
// Deterministic farthest-first init → reproducible (no RNG). Design Ref: §6.2.

import { cosineSimilarity, normalizeVector } from '../../utils/math.js';

/** Mean vector of a set (NOT normalized — caller normalizes if it wants a unit centroid). */
export function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0) as number[];
  for (const v of vectors) {
    for (let d = 0; d < dim; d++) sum[d] += v[d];
  }
  for (let d = 0; d < dim; d++) sum[d] /= vectors.length;
  return sum;
}

/**
 * Cluster `vectors` into `k` groups by cosine similarity. Returns a per-vector cluster
 * assignment (0..k-1). Does not mutate the input. Deterministic for a given input.
 */
export function cosineKMeans(vectors: number[][], k: number, maxIter = 50): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  k = Math.max(1, Math.min(k, n));

  // Work on unit-normalized copies (never mutate caller's vectors).
  const X = vectors.map((v) => normalizeVector(v.slice()));
  const dim = X[0].length;

  // Farthest-first seeding (deterministic): start at X[0], then repeatedly pick the
  // vector most dissimilar to all chosen centroids.
  const centroids: number[][] = [X[0].slice()];
  while (centroids.length < k) {
    let bestIdx = 0;
    let bestScore = Infinity; // minimise the max-sim-to-chosen
    for (let i = 0; i < n; i++) {
      let maxSim = -Infinity;
      for (const c of centroids) maxSim = Math.max(maxSim, cosineSimilarity(X[i], c));
      if (maxSim < bestScore) { bestScore = maxSim; bestIdx = i; }
    }
    centroids.push(X[bestIdx].slice());
  }

  const assign = new Array(n).fill(0) as number[];
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    // Assignment step.
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c++) {
        const s = cosineSimilarity(X[i], centroids[c]);
        if (s > bestSim) { bestSim = s; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    // Update step: centroid = normalized mean of members (empty clusters keep old centroid).
    const sums = Array.from({ length: k }, () => new Array(dim).fill(0) as number[]);
    const counts = new Array(k).fill(0) as number[];
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      counts[c]++;
      const xi = X[i];
      const sc = sums[c];
      for (let d = 0; d < dim; d++) sc[d] += xi[d];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      for (let d = 0; d < dim; d++) sums[c][d] /= counts[c];
      centroids[c] = normalizeVector(sums[c]);
    }
    if (!changed) break;
  }
  return assign;
}
