// Design Ref: Phase 3 FR-06~07 — .sv-pack 가져오기 + 벡터 DB 병합

import { readFileSync } from 'node:fs';
import type { VectorStore } from '../store/types.js';
import type { Embedder } from '../indexer/embedder.js';
import type { KnowledgePack } from './types.js';

export interface ImportResult {
  imported: number;
  skipped: number;
  reEmbedded: number;
  modelMismatch: boolean;
}

export async function importPack(
  store: VectorStore,
  embedder: Embedder,
  filePath: string,
): Promise<ImportResult> {
  const raw = readFileSync(filePath, 'utf-8');
  const pack: KnowledgePack = JSON.parse(raw);

  // 임베딩 모델 불일치 감지
  const modelMismatch = pack.embeddingModel !== embedder.modelName ||
    pack.embeddingDimensions !== embedder.dimensions;

  let imported = 0;
  let skipped = 0;
  let reEmbedded = 0;

  // 팩 문서를 pack_{name} prefix로 저장
  const packDocId = `pack_${pack.name}`;

  await store.upsertDocument({
    id: packDocId,
    filePath: `[pack] ${pack.name}`,
    title: `${pack.name} (Knowledge Pack)`,
    content: `Imported pack: ${pack.description}\nChunks: ${pack.chunks.length}\nAuthor: ${pack.author}`,
    frontmatter: { pack: pack.name, license: pack.license },
    tags: pack.tags,
    lastModified: pack.createdAt,
    contentHash: `pack_${pack.name}_${pack.version}`,
  });

  const chunks = [];
  for (let i = 0; i < pack.chunks.length; i++) {
    const pc = pack.chunks[i];

    let embedding = pc.embedding;

    // 모델 불일치 시 재임베딩
    if (modelMismatch) {
      embedding = await embedder.embed(pc.content);
      reEmbedded++;
    }

    // 차원 검증
    if (embedding.length !== embedder.dimensions) {
      skipped++;
      continue;
    }

    chunks.push({
      id: `${packDocId}#${i}`,
      documentId: packDocId,
      content: pc.content,
      heading: pc.heading || pack.name,
      startLine: 0,
      endLine: 0,
      tokenCount: Math.ceil(pc.content.length / 4),
      embedding,
    });

    imported++;
  }

  if (chunks.length > 0) {
    await store.upsertChunks(chunks);
  }

  return { imported, skipped, reEmbedded, modelMismatch };
}
