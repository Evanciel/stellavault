// Design Ref: §6.3 — Incremental Indexing + Pipeline

import type { Embedder } from './embedder.js';
import type { VectorStore } from '../store/types.js';
import type { Document } from '../types/document.js';
import type { Chunk } from '../types/chunk.js';
import { existsSync } from 'node:fs';
import { scanVault, scanFile, docIdForPath, type SkippedFile } from './scanner.js';
import { chunkDocument, type ChunkOptions } from './chunker.js';
import { extractEntities } from './entity-extractor.js';
import { withRetry, errors } from '../utils/retry.js';

export { type Embedder } from './embedder.js';
export { createLocalEmbedder } from './local-embedder.js';
export { scanVault, scanFile, docIdForPath, type SkippedFile, type SkipReason } from './scanner.js';
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
  failed: number;
  totalChunks: number;
  elapsedMs: number;
  totalFiles: number;
  skippedFiles: SkippedFile[];
  failedFiles: { path: string; error: string }[];
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
  const scan = scanVault(vaultPath);
  const { documents } = scan;

  // 2. 기존 인덱스 상태 조회
  const existingDocs = await store.getAllDocuments();
  const existingMap = new Map(existingDocs.map(d => [d.id, d.contentHash]));

  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let totalChunks = 0;
  const failedFiles: { path: string; error: string }[] = [];

  // 3. 증분 처리 (에러 복구 포함)
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

    try {
      // 청킹
      const chunks = chunkDocument(doc.id, doc.content, chunkOptions);

      // 임베딩 (retry with backoff)
      const texts = chunks.map(c => c.content);
      const embeddings = await withRetry(
        () => embedder.embedBatch(texts),
        { maxRetries: 2, baseDelayMs: 1000 },
      );
      const chunksWithEmbeddings: Chunk[] = chunks.map((c, j) => ({
        ...c,
        embedding: embeddings[j],
        entities: extractEntities({
          content: c.content,
          heading: c.heading,
          title: doc.title,
          tags: doc.tags,
        }),
      }));

      // 저장 (document → chunks)
      await store.upsertDocument(doc);
      await store.upsertChunks(chunksWithEmbeddings);

      indexed++;
      totalChunks += chunks.length;
    } catch (err) {
      // Graceful degradation: skip failed file, continue with rest
      failed++;
      failedFiles.push({ path: doc.filePath, error: (err as Error)?.message ?? String(err) });
      console.error(errors.indexingFailed(doc.filePath, err).format());
    }
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
    failed,
    totalChunks,
    elapsedMs: Date.now() - start,
    totalFiles: scan.scannedFiles,
    skippedFiles: scan.skipped,
    failedFiles,
  };
}

/**
 * Design Ref: §6.3 — Targeted incremental index (T2-2).
 *
 * Index ONLY the given absolute file paths (the desktop watcher's changed batch),
 * instead of re-walking + re-hashing the entire vault via {@link indexVault}.
 * Per-file content-hash skip is preserved (unchanged files re-embed nothing).
 * Paths that no longer exist on disk are treated as deletions and removed from
 * the index. Errors on individual files degrade gracefully (skip + continue).
 *
 * @param vaultPath - vault root (for relative-path / id derivation)
 * @param filePaths - absolute paths of changed/added/removed *.md files
 */
export async function indexFiles(
  vaultPath: string,
  filePaths: string[],
  options: IndexerOptions,
): Promise<IndexResult> {
  const start = Date.now();
  const { store, embedder, chunkOptions, onProgress } = options;

  // Only the changed docs' hashes matter — fetch the full existing map once and
  // look up each by id (cheaper than a vault-wide diff). (§6.3)
  const existingDocs = await store.getAllDocuments();
  const existingMap = new Map(existingDocs.map(d => [d.id, d.contentHash]));

  let indexed = 0;
  let skipped = 0;
  let deleted = 0;
  let failed = 0;
  let totalChunks = 0;
  const skippedFiles: SkippedFile[] = [];
  const failedFiles: { path: string; error: string }[] = [];

  // De-dup while preserving order (a batch may list the same path twice).
  const uniquePaths = [...new Set(filePaths)];

  for (let i = 0; i < uniquePaths.length; i++) {
    const filePath = uniquePaths[i];

    // Deletion: path gone from disk → drop its index rows.
    if (!existsSync(filePath)) {
      try {
        await store.deleteByDocumentId(docIdForPath(vaultPath, filePath));
        deleted++;
      } catch (err) {
        failed++;
        failedFiles.push({ path: filePath, error: (err as Error)?.message ?? String(err) });
        console.error(errors.indexingFailed(filePath, err).format());
      }
      continue;
    }

    const result = scanFile(vaultPath, filePath);
    if ('skipped' in result) {
      skipped++;
      skippedFiles.push(result.skipped);
      continue;
    }
    const doc = result.document;
    onProgress?.(i + 1, uniquePaths.length, doc);

    // content_hash 비교 → 변경 없으면 SKIP
    if (existingMap.get(doc.id) === doc.contentHash) {
      skipped++;
      continue;
    }

    try {
      const chunks = chunkDocument(doc.id, doc.content, chunkOptions);
      const texts = chunks.map(c => c.content);
      const embeddings = await withRetry(
        () => embedder.embedBatch(texts),
        { maxRetries: 2, baseDelayMs: 1000 },
      );
      const chunksWithEmbeddings: Chunk[] = chunks.map((c, j) => ({
        ...c,
        embedding: embeddings[j],
        entities: extractEntities({
          content: c.content,
          heading: c.heading,
          title: doc.title,
          tags: doc.tags,
        }),
      }));

      await store.upsertDocument(doc);
      await store.upsertChunks(chunksWithEmbeddings);

      indexed++;
      totalChunks += chunks.length;
    } catch (err) {
      failed++;
      failedFiles.push({ path: doc.filePath, error: (err as Error)?.message ?? String(err) });
      console.error(errors.indexingFailed(doc.filePath, err).format());
    }
  }

  return {
    indexed,
    skipped,
    deleted,
    failed,
    totalChunks,
    elapsedMs: Date.now() - start,
    totalFiles: uniquePaths.length,
    skippedFiles,
    failedFiles,
  };
}
