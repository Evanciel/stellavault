// Design Ref: §3.2 — Embedder 로컬 구현 (nomic-embed-text via @xenova/transformers)

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Embedder } from './embedder.js';

// 모델 싱글톤 캐시 — 동일 프로세스에서 같은 모델 재로드 방지 (ONNX 세션 재사용)
const pipelineCache = new Map<string, Promise<any>>();

function getPipeline(modelName: string): Promise<any> {
  let p = pipelineCache.get(modelName);
  if (p) return p;
  p = (async () => {
    const { pipeline: createPipeline, env } = await import('@xenova/transformers');
    // transformers' default cacheDir is node_modules/@xenova/transformers/.cache —
    // inside Electron's app.asar that path is read-only, so model downloads fail
    // forever (embedder.initialize never resolves). Redirect to a writable dir.
    // Plain Node installs keep the default (existing users keep their cache).
    const cacheOverride = process.env.STELLAVAULT_MODEL_CACHE;
    if (cacheOverride) {
      env.cacheDir = cacheOverride;
    } else if (/\.asar[\\/]/.test(env.cacheDir ?? '')) {
      env.cacheDir = join(homedir(), '.stellavault', 'model-cache');
    }
    try { mkdirSync(env.cacheDir, { recursive: true }); } catch { /* transformers will surface real errors */ }
    return createPipeline('feature-extraction', `Xenova/${modelName}`, { quantized: true });
  })();
  pipelineCache.set(modelName, p);
  return p;
}

export function createLocalEmbedder(modelName: string = 'nomic-embed-text-v1.5'): Embedder {
  let pipeline: any;
  // all-MiniLM-L6-v2: 384, paraphrase-multilingual-MiniLM-L12-v2: 384, nomic-embed-text: 768
  let dims = modelName.includes('MiniLM') ? 384 : 768;
  const profile = process.env.STELLAVAULT_PROFILE_MEMORY === '1';
  let callCount = 0;

  return {
    async initialize() {
      pipeline = await getPipeline(modelName);
    },

    async embed(text: string): Promise<number[]> {
      if (!pipeline) pipeline = await getPipeline(modelName); // lazy-init (memoized) — safe before initialize()
      let output: any = await pipeline(text, { pooling: 'mean', normalize: true });
      const result = Array.from(output.data as Float32Array).slice(0, dims);
      try { output.dispose?.(); } catch { /* noop */ }
      output = null;
      return result;
    },

    async embedBatch(texts: string[], batchSize = 16): Promise<number[][]> {
      if (!pipeline) pipeline = await getPipeline(modelName); // lazy-init (memoized)
      const results: number[][] = [];
      let processed = 0;
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        let output: any = await pipeline(batch, { pooling: 'mean', normalize: true });
        const flat = output.data as Float32Array;
        for (let j = 0; j < batch.length; j++) {
          results.push(Array.from(flat.subarray(j * dims, (j + 1) * dims)));
        }
        try { output.dispose?.(); } catch { /* transformers tensor may not expose dispose */ }
        output = null;
        processed += batch.length;
        callCount += batch.length;
        if (processed % 256 === 0 && typeof (globalThis as any).gc === 'function') {
          (globalThis as any).gc();
        }
        if (profile && callCount % 100 < batchSize) {
          const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
          const heap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
          console.error(`[profile-memory] embedded=${callCount} rss=${rss}MB heap=${heap}MB`);
        }
      }
      return results;
    },

    get dimensions() { return dims; },
    get modelName() { return modelName; },
  };
}
