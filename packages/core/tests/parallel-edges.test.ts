// Real worker spawning, NOT mocks.
//
// The worker body ships as a string constant inside src/parallel/worker-source.ts precisely
// so that the same bytes run under vitest, the esbuild CLI bundle, Vite/Electron and inside
// app.asar. Mocking the pool would test none of that; every test here launches real
// worker_threads, so what passes is the artifact that ships.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import {
  computeTopKEdgesParallel, shouldParallelize, allocPackedVectors,
  shutdownPool, activeWorkerCount,
} from '../src/parallel/pool.js';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import { createApiServer } from '../src/api/server.js';
import type { VectorStore } from '../src/store/types.js';
import type { Embedder } from '../src/indexer/embedder.js';
import { buildGraphData } from '../src/api/graph-data.js';

const ENV_KEYS = [
  'STELLAVAULT_PARALLEL',
  'STELLAVAULT_PARALLEL_MIN_N',
  'STELLAVAULT_PARALLEL_WORKERS',
  'STELLAVAULT_PARALLEL_TIMEOUT_MS',
] as const;

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  // Never leak an isolate into the next test file — a live worker_thread keeps the host
  // process alive, which is the exact Electron bug shutdownPool exists for.
  await shutdownPool();
});

// ─── deterministic synthetic embeddings ───

/** mulberry32 — same seed, same matrix, on every machine and every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Clustered unit vectors, not uniform noise: in high dimensions random vectors are all
 * near-orthogonal, so a 0.35 threshold would reject nearly every pair and the top-K
 * replacement path — the part that can diverge — would never run.
 *
 * Every 7th vector is an EXACT copy of its group centroid. That manufactures exact ties
 * (several peers offering the identical similarity), which is where a non-deterministic
 * merge order would show up: with fixed K the winner among equals depends entirely on visit
 * order.
 */
function clusteredVectors(n: number, dim: number, groups: number, seed: number): number[][] {
  const rnd = mulberry32(seed);
  const centroids: number[][] = [];
  for (let g = 0; g < groups; g++) {
    centroids.push(Array.from({ length: dim }, () => rnd() * 2 - 1));
  }
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const c = centroids[i % groups];
    const exact = i % 7 === 0;
    out.push(c.map((x) => (exact ? x : x + (rnd() - 0.5) * 0.9)));
  }
  return out;
}

/** Pack + unit-normalize exactly the way buildGraphData does, so `flat` matches production. */
function pack(vectors: number[][], shared: boolean): { flat: Float32Array; n: number; dim: number } {
  const n = vectors.length;
  const dim = vectors[0].length;
  const flat = allocPackedVectors(n * dim, shared);
  for (let i = 0; i < n; i++) {
    const v = vectors[i];
    let mag = 0;
    for (let d = 0; d < dim; d++) mag += v[d] * v[d];
    mag = Math.sqrt(mag) || 1;
    const off = i * dim;
    for (let d = 0; d < dim; d++) flat[off + d] = v[d] / mag;
  }
  return { flat, n, dim };
}

/** Byte-for-byte transcription of the serial loop in graph-data.ts — the reference oracle. */
function serialTopK(flat: Float32Array, n: number, dim: number, K: number, threshold: number) {
  const bestSim = new Float32Array(n * K).fill(-1);
  const bestPeer = new Int32Array(n * K).fill(-1);
  const offer = (node: number, peer: number, sim: number): void => {
    const base = node * K;
    let worst = 0;
    for (let t = 1; t < K; t++) if (bestSim[base + t] < bestSim[base + worst]) worst = t;
    if (sim > bestSim[base + worst]) { bestSim[base + worst] = sim; bestPeer[base + worst] = peer; }
  };
  for (let i = 0; i < n; i++) {
    const oi = i * dim;
    for (let j = i + 1; j < n; j++) {
      const oj = j * dim;
      let sim = 0;
      for (let d = 0; d < dim; d++) sim += flat[oi + d] * flat[oj + d];
      if (sim >= threshold) { offer(i, j, sim); offer(j, i, sim); }
    }
  }
  return { bestSim, bestPeer };
}

/** Index of the first differing slot, or -1. Object.is so -0/NaN cannot compare equal by accident. */
function firstDiff(a: { bestSim: Float32Array; bestPeer: Int32Array }, b: { bestSim: Float32Array; bestPeer: Int32Array }): number {
  for (let i = 0; i < a.bestPeer.length; i++) {
    if (a.bestPeer[i] !== b.bestPeer[i]) return i;
    if (!Object.is(a.bestSim[i], b.bestSim[i])) return i;
  }
  return -1;
}

describe('parallel top-K edge pass', () => {
  it('produces slots byte-identical to the serial loop, ties included', async () => {
    process.env.STELLAVAULT_PARALLEL_MIN_N = '16';
    process.env.STELLAVAULT_PARALLEL_WORKERS = '3';

    const K = 5;
    const threshold = 0.35;
    const { flat, n, dim } = pack(clusteredVectors(400, 24, 8, 1234), true);

    const ref = serialTopK(flat, n, dim, K, threshold);

    const bestSim = new Float32Array(n * K).fill(-1);
    const bestPeer = new Int32Array(n * K).fill(-1);
    const ok = await computeTopKEdgesParallel({ flat, n, dim, K, threshold, bestSim, bestPeer });

    // Proves workers actually ran — an equivalence assertion alone would also pass if the
    // pool had silently bailed and the caller fell back.
    expect(ok).toBe(true);
    expect(firstDiff({ bestSim, bestPeer }, ref)).toBe(-1);

    // The fixture must actually exercise the replacement path, else this asserts nothing.
    expect(bestPeer.filter((p) => p >= 0).length).toBeGreaterThan(n);
  });

  it('reports row progress and terminates every worker when it resolves', async () => {
    process.env.STELLAVAULT_PARALLEL_MIN_N = '16';
    process.env.STELLAVAULT_PARALLEL_WORKERS = '2';

    const K = 3;
    const { flat, n, dim } = pack(clusteredVectors(200, 16, 5, 99), true);
    const bestSim = new Float32Array(n * K).fill(-1);
    const bestPeer = new Int32Array(n * K).fill(-1);

    const seen: number[] = [];
    const ok = await computeTopKEdgesParallel({
      flat, n, dim, K, threshold: 0.3, bestSim, bestPeer,
      onProgress: (done, total) => { seen.push(done); expect(total).toBe(n); },
    });

    expect(ok).toBe(true);
    expect(seen.length).toBeGreaterThan(1);          // multiple blocks, not one lump
    expect(seen[seen.length - 1]).toBe(n);           // every row accounted for
    expect(activeWorkerCount()).toBe(0);             // pool reaped itself in its finally
  });

  it('shutdownPool terminates live workers and the abandoned run falls back', async () => {
    process.env.STELLAVAULT_PARALLEL_MIN_N = '16';
    process.env.STELLAVAULT_PARALLEL_WORKERS = '4';

    const K = 5;
    const { flat, n, dim } = pack(clusteredVectors(900, 64, 10, 7), true);
    const bestSim = new Float32Array(n * K).fill(-1);
    const bestPeer = new Int32Array(n * K).fill(-1);

    const pending = computeTopKEdgesParallel({ flat, n, dim, K, threshold: 0.3, bestSim, bestPeer });

    // Wait for real isolates to exist, then kill them mid-flight.
    const deadline = Date.now() + 10_000;
    while (activeWorkerCount() === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(activeWorkerCount()).toBeGreaterThan(0);

    await shutdownPool();
    expect(activeWorkerCount()).toBe(0);

    // Killed workers must degrade to "caller runs serial", never to a thrown build.
    await expect(pending).resolves.toBe(false);
  });
});

describe('serial gating', () => {
  it('STELLAVAULT_PARALLEL=0 forces serial and leaves the slots untouched', async () => {
    process.env.STELLAVAULT_PARALLEL = '0';
    process.env.STELLAVAULT_PARALLEL_MIN_N = '16';

    expect(shouldParallelize(50_000)).toBe(false);

    const K = 3;
    const { flat, n, dim } = pack(clusteredVectors(100, 16, 4, 5), true);
    const bestSim = new Float32Array(n * K).fill(-1);
    const bestPeer = new Int32Array(n * K).fill(-1);

    const ok = await computeTopKEdgesParallel({ flat, n, dim, K, threshold: 0.3, bestSim, bestPeer });
    expect(ok).toBe(false);
    expect(activeWorkerCount()).toBe(0);
    expect(bestPeer.every((p) => p === -1)).toBe(true);
  });

  it('small n stays serial — worker startup dominates below the threshold', () => {
    expect(shouldParallelize(0)).toBe(false);
    expect(shouldParallelize(50)).toBe(false);
    expect(shouldParallelize(1199)).toBe(false);
    expect(shouldParallelize(1200)).toBe(true);
  });

  it('a non-shared buffer refuses the pool rather than deep-copying per worker', async () => {
    process.env.STELLAVAULT_PARALLEL_MIN_N = '16';
    const K = 3;
    const { flat, n, dim } = pack(clusteredVectors(100, 16, 4, 5), false); // plain ArrayBuffer
    const bestSim = new Float32Array(n * K).fill(-1);
    const bestPeer = new Int32Array(n * K).fill(-1);

    const ok = await computeTopKEdgesParallel({ flat, n, dim, K, threshold: 0.3, bestSim, bestPeer });
    expect(ok).toBe(false);
  });
});

describe('buildGraphData serial vs parallel', () => {
  const DIMS = 16;
  const DOCS = 200;
  let store: VectorStore;

  beforeEach(async () => {
    store = createSqliteVecStore(':memory:', DIMS);
    await store.initialize();

    const vectors = clusteredVectors(DOCS, DIMS, 6, 4242);
    for (let i = 0; i < DOCS; i++) {
      const id = `doc${String(i).padStart(4, '0')}`;
      await store.upsertDocument({
        id, filePath: `folder${i % 4}/note${i}.md`, title: `Note ${i}`,
        content: `Body ${i}`, frontmatter: {}, tags: ['t'],
        // Distinct + descending so the recency ranking that feeds the edge loop is stable.
        lastModified: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
        contentHash: `hash${i}`,
      });
      await store.upsertChunks([{
        id: `${id}#0`, documentId: id, content: `Body ${i}`,
        heading: `Note ${i}`, startLine: 1, endLine: 1, tokenCount: 2,
        embedding: vectors[i],
      }]);
    }
  });

  afterEach(async () => { await store.close(); });

  it('yields an identical edge set through the real build', async () => {
    process.env.STELLAVAULT_PARALLEL = '0';
    const serial = await buildGraphData(store, { mode: 'folder', nodeCap: DOCS, edgeThreshold: 0.3 });

    process.env.STELLAVAULT_PARALLEL = '1';
    process.env.STELLAVAULT_PARALLEL_MIN_N = '32';
    process.env.STELLAVAULT_PARALLEL_WORKERS = '3';

    // 이 테스트가 "병렬 경로를 통째로 지워도 그대로 통과"하면 안 된다. 직렬 폴백은 결과가
    // 동일하므로 엣지 비교만으로는 경로를 구분할 수 없다 — 실제로 워커가 떴는지를 직접 본다.
    // activeWorkerCount() 는 병렬 경로에서만 0보다 크므로, 폴백이 일어나면 이 값이 0에 머문다.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let maxWorkersSeen = 0;
    let parallel;
    try {
      parallel = await buildGraphData(store, {
        mode: 'folder', nodeCap: DOCS, edgeThreshold: 0.3,
        onProgress: () => { maxWorkersSeen = Math.max(maxWorkersSeen, activeWorkerCount()); },
      });
    } finally {
      errors.mockRestore();
    }
    // toContain 은 === 비교라 asymmetric matcher 와는 절대 일치하지 않는다(항상 통과하는
    // 가짜 단언이었다). 문자열 포함 여부를 직접 본다.
    const loggedFallback = errors.mock.calls.some((c) => String(c[0]).includes('falling back'));
    expect(loggedFallback).toBe(false);
    expect(maxWorkersSeen).toBeGreaterThan(0);

    expect(serial.edges.length).toBeGreaterThan(0);
    expect(parallel.edges.length).toBe(serial.edges.length);
    for (let i = 0; i < serial.edges.length; i++) {
      expect(parallel.edges[i].source).toBe(serial.edges[i].source);
      expect(parallel.edges[i].target).toBe(serial.edges[i].target);
      expect(Object.is(parallel.edges[i].weight, serial.edges[i].weight)).toBe(true);
    }
    // folder mode only: semantic clustering seeds k-means++ from Math.random(), so cluster
    // ids legitimately differ run to run and say nothing about the edge pass.
    expect(parallel.nodes.map((x) => x.clusterId)).toEqual(serial.nodes.map((x) => x.clusterId));
  });

  it('emits build progress through the edge phase', async () => {
    process.env.STELLAVAULT_PARALLEL_MIN_N = '32';
    process.env.STELLAVAULT_PARALLEL_WORKERS = '2';

    const phases: string[] = [];
    let lastEdgeDone = 0;
    await buildGraphData(store, {
      mode: 'folder', nodeCap: DOCS, edgeThreshold: 0.3,
      onProgress: (p) => {
        if (phases[phases.length - 1] !== p.phase) phases.push(p.phase);
        if (p.phase === 'edges') { expect(p.total).toBe(DOCS); lastEdgeDone = p.done; }
      },
    });

    expect(phases[0]).toBe('loading');
    expect(phases).toContain('edges');
    expect(phases[phases.length - 1]).toBe('done');
    expect(lastEdgeDone).toBe(DOCS);
  });
});

describe('/api/graph single-flight + status', () => {
  const DIMS = 4;
  let store: VectorStore;
  let listener: import('node:http').Server;
  let port = 0;
  let metaCalls = 0;

  beforeEach(async () => {
    store = createSqliteVecStore(':memory:', DIMS);
    await store.initialize();
    for (let i = 0; i < 6; i++) {
      await store.upsertDocument({
        id: `d${i}`, filePath: `f${i % 2}/n${i}.md`, title: `N${i}`,
        content: `c${i}`, frontmatter: {}, tags: [], lastModified: `2026-01-0${i + 1}`,
        contentHash: `h${i}`,
      });
      await store.upsertChunks([{
        id: `d${i}#0`, documentId: `d${i}`, content: `c${i}`, heading: `N${i}`,
        startLine: 1, endLine: 1, tokenCount: 1,
        embedding: [Math.cos(i), Math.sin(i), 0.3, 0.4],
      }]);
    }

    // The build is instant on 6 docs, so single-flight would be untestable by timing alone.
    // Delaying the FIRST store call the build makes both widens the overlap window
    // deterministically and gives an exact "how many builds actually started" counter.
    metaCalls = 0;
    const slowStore = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === 'getDocumentsMeta') {
          return async () => {
            metaCalls++;
            await new Promise((r) => setTimeout(r, 150));
            return target.getDocumentsMeta();
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as VectorStore;

    const embedder: Embedder = {
      dimensions: DIMS, modelName: 'test',
      initialize: async () => {},
      embed: async () => [0.5, 0.5, 0.5, 0.5],
      embedBatch: async (texts) => texts.map(() => [0.5, 0.5, 0.5, 0.5]),
    };
    // port 0 = ephemeral, so this never collides with the other API test files' fixed ports.
    const api = createApiServer({ store: slowStore, searchEngine: createSearchEngine({ store: slowStore, embedder }) });
    listener = api.app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => listener.once('listening', () => r()));
    port = (listener.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => listener.close(() => r()));
    await store.close();
  });

  it('joins an in-flight build instead of starting a second one', async () => {
    const url = `http://127.0.0.1:${port}/api/graph?view=raw`;
    const [a, b] = await Promise.all([fetch(url).then((r) => r.json()), fetch(url).then((r) => r.json())]);

    expect(metaCalls).toBe(1);
    expect(a.generatedAt).toBe(b.generatedAt);
    expect(a.data.nodes.length).toBe(6);
  });

  it('reports build state on /api/graph/status while the handler stays responsive', async () => {
    const idle = await (await fetch(`http://127.0.0.1:${port}/api/graph/status`)).json();
    expect(idle).toEqual({ building: false, phase: 'idle', done: 0, total: 0 });

    const inflight = fetch(`http://127.0.0.1:${port}/api/graph?view=raw`).then((r) => r.json());

    // Served DURING the build — the point of moving the edge pass off the event loop.
    let sawBuilding = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const s = await (await fetch(`http://127.0.0.1:${port}/api/graph/status`)).json();
      if (s.building) { sawBuilding = true; expect(typeof s.phase).toBe('string'); break; }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(sawBuilding).toBe(true);

    await inflight;
    const after = await (await fetch(`http://127.0.0.1:${port}/api/graph/status`)).json();
    expect(after.building).toBe(false);
  });
});
