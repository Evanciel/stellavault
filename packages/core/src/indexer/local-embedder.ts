// Design Ref: §3.2 — Embedder 로컬 구현 (nomic-embed-text via @xenova/transformers)

import type { Embedder } from './embedder.js';

export function createLocalEmbedder(modelName: string = 'nomic-embed-text-v1.5'): Embedder {
  let pipeline: any;
  // all-MiniLM-L6-v2: 384, nomic-embed-text: 768
  let dims = modelName.includes('MiniLM') ? 384 : 768;

  return {
    async initialize() {
      const { pipeline: createPipeline } = await import('@xenova/transformers');
      pipeline = await createPipeline('feature-extraction', `Xenova/${modelName}`, {
        quantized: true,
      });
    },

    async embed(text: string): Promise<number[]> {
      const output = await pipeline(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data as Float32Array).slice(0, dims);
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      const results: number[][] = [];
      // 순차 처리 (메모리 절약)
      for (const text of texts) {
        results.push(await this.embed(text));
      }
      return results;
    },

    get dimensions() { return dims; },
    get modelName() { return modelName; },
  };
}
