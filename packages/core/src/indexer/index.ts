// Design Ref: §6.3 — Incremental Indexing + Pipeline

import type { Embedder } from './embedder.js';
import type { VectorStore } from '../store/types.js';
import type { Document } from '../types/document.js';
import type { Chunk } from '../types/chunk.js';
import { scanVault } from './scanner.js';
import { chunkDocument, type ChunkOptions } from './chunker.js';

export { type Embedder } from './embedder.js';
export { createLocalEmbedder } from './local-embedder.js';
export { scanVault } from './scanner.js';
export { chunkDocument, estimateTokens } from './chunker.js';
export { createWatcher } from './watcher.js';

export interface IndexerOptions {
  store: VectorStore;
  embedder: Embedder;
  chunkOptions?: Partial<ChunkOptions>;
  onProgress?: (current: number, total: number, doc: Document) => void;
}

export interface IndexResult {
  indexed: number;
  skipped: number;
  deleted: number;
  totalChunks: number;
  elapsedMs: number;
}

/**
 * vault를 스캔하여 변경된 문서만 벡터화하는 증분 인덱서
 */
export async function indexVault(
  vaultPath: string,
  options: IndexerOptions,
): Promise<IndexResult> {
  const start = Date.now();
  const { store, embedder, chunkOptions, onProgress } = options;

  // 1. 스캔
  const { documents } = scanVault(vaultPath);

  // 2. 기존 인덱스 상태 조회
  const existingDocs = await store.getAllDocuments();
  const existingMap = new Map(existingDocs.map(d => [d.id, d.contentHash]));

  let indexed = 0;
  let skipped = 0;
  let totalChunks = 0;

  // 3. 증분 처리
  const scannedIds = new Set<string>();
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    scannedIds.add(doc.id);
    onProgress?.(i + 1, documents.length, doc);

    // content_hash 비교 → 변경 없으면 SKIP
    if (existingMap.get(doc.id) === doc.contentHash) {
      skipped++;
      continue;
    }

    // 청킹
    const chunks = chunkDocument(doc.id, doc.content, chunkOptions);

    // 임베딩
    const texts = chunks.map(c => c.content);
    const embeddings = await embedder.embedBatch(texts);
    const chunksWithEmbeddings: Chunk[] = chunks.map((c, j) => ({
      ...c,
      embedding: embeddings[j],
    }));

    // 저장 (document → chunks)
    await store.upsertDocument(doc);
    await store.upsertChunks(chunksWithEmbeddings);

    indexed++;
    totalChunks += chunks.length;
  }

  // 4. 삭제된 파일 처리
  let deleted = 0;
  for (const [existingId] of existingMap) {
    if (!scannedIds.has(existingId)) {
      await store.deleteByDocumentId(existingId);
      deleted++;
    }
  }

  return {
    indexed,
    skipped,
    deleted,
    totalChunks,
    elapsedMs: Date.now() - start,
  };
}
