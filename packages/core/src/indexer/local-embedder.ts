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

    async embedBatch(texts: string[], batchSize = 32): Promise<number[][]> {
      const results: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const output = await pipeline(batch, { pooling: 'mean', normalize: true });
        // output.data is a flat Float32Array of (batch.length * dims) elements
        const flat = output.data as Float32Array;
        for (let j = 0; j < batch.length; j++) {
          results.push(Array.from(flat.slice(j * dims, (j + 1) * dims)));
        }
      }
      return results;
    },

    get dimensions() { return dims; },
    get modelName() { return modelName; },
  };
}
