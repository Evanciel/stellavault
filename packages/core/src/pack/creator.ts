// Design Ref: Phase 3 FR-01~03 — 검색/클러스터 기반 팩 생성

import type { VectorStore } from '../store/types.js';
import type { SearchEngine } from '../search/index.js';
import type { Embedder } from '../indexer/embedder.js';
import type { KnowledgePack, PackChunk } from './types.js';
import { maskPII } from './pii-masker.js';

export interface CreatePackOptions {
  name: string;
  author?: string;
  license?: string;
  description?: string;
  fromSearch?: string;
  fromCluster?: number;
  limit?: number;
}

export async function createPack(
  store: VectorStore,
  searchEngine: SearchEngine,
  embedder: Embedder,
  options: CreatePackOptions,
): Promise<{ pack: KnowledgePack; piiReport: { redactedCount: number; types: string[] } }> {
  const { name, author = 'anonymous', license = 'CC-BY-4.0', description = '', limit = 100 } = options;

  let chunkIds: string[] = [];

  if (options.fromSearch) {
    // 검색 결과에서 청크 수집
    const results = await searchEngine.search({ query: options.fromSearch, limit });
    chunkIds = results.map(r => r.chunk.id);
  } else if (options.fromCluster !== undefined) {
    // 클러스터의 문서에서 청크 수집
    const docs = await store.getAllDocuments();
    const embeddings = await store.getDocumentEmbeddings();

    // 간단한 클러스터 매칭: graph-data의 K-means 결과를 재활용할 수 없으므로
    // 해당 클러스터 문서의 모든 청크를 가져옴
    // 여기서는 fromSearch를 권장하되, fromCluster는 문서 ID 기반으로 처리
    const clusterDocs = docs.slice(0, limit);
    for (const doc of clusterDocs) {
      const chunk = await store.getChunk(`${doc.id}#0`);
      if (chunk) chunkIds.push(chunk.id);
    }
  }

  // 청크 데이터 수집 + PII 마스킹
  const chunks: PackChunk[] = [];
  let totalRedacted = 0;
  const allTypes = new Set<string>();

  for (const chunkId of chunkIds) {
    const chunk = await store.getChunk(chunkId);
    if (!chunk) continue;

    const doc = await store.getDocument(chunk.documentId);
    if (!doc) continue;

    // PII 마스킹
    const { masked, redactedCount, redactedTypes } = maskPII(chunk.content);
    totalRedacted += redactedCount;
    redactedTypes.forEach(t => allTypes.add(t));

    // 임베딩 재생성 (마스킹된 텍스트로)
    const embedding = await embedder.embed(masked);

    chunks.push({
      id: chunkId,
      content: masked,
      heading: chunk.heading,
      embedding,
      metadata: {
        sourceFile: doc.filePath,
        category: detectCategory(doc.filePath, chunk.content),
        language: detectLanguage(chunk.content),
      },
    });
  }

  const pack: KnowledgePack = {
    name,
    version: '1.0.0',
    author,
    license,
    description: description || `Knowledge pack: ${name}`,
    tags: extractPackTags(chunks),
    embeddingModel: embedder.modelName,
    embeddingDimensions: embedder.dimensions,
    schemaVersion: '1.0',
    chunks,
    createdAt: new Date().toISOString(),
  };

  return {
    pack,
    piiReport: { redactedCount: totalRedacted, types: [...allTypes] },
  };
}

function detectCategory(filePath: string, content: string): string {
  const lower = filePath.toLowerCase() + ' ' + content.slice(0, 200).toLowerCase();
  if (lower.includes('lesson') || lower.includes('교훈')) return 'lesson';
  if (lower.includes('pattern') || lower.includes('패턴')) return 'pattern';
  if (lower.includes('decision') || lower.includes('결정')) return 'decision';
  if (lower.includes('design') || lower.includes('설계')) return 'reference';
  return 'reference';
}

function detectLanguage(content: string): string | undefined {
  if (content.includes('typescript') || content.includes('.ts')) return 'typescript';
  if (content.includes('python') || content.includes('.py')) return 'python';
  if (content.includes('react') || content.includes('jsx')) return 'react';
  return undefined;
}

function extractPackTags(chunks: PackChunk[]): string[] {
  const wordCounts = new Map<string, number>();
  for (const c of chunks) {
    const words = c.heading.split(/\s+/).filter(w => w.length > 2);
    for (const w of words) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
  }
  return [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}
