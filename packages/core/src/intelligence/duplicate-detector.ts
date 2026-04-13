// Design Ref: 중복/유사 노트 탐지
// 기존 벡터 임베딩의 cosine similarity 활용

import type { VectorStore } from '../store/types.js';
import { cosineSimilarity } from '../utils/math.js';

export interface DuplicatePair {
  docA: { id: string; title: string; filePath: string };
  docB: { id: string; title: string; filePath: string };
  similarity: number;
}

/**
 * 벡터 유사도 기반 중복 노트 탐지.
 * 문서별 평균 임베딩을 비교하여 threshold 이상인 쌍을 반환.
 */
export async function detectDuplicates(
  store: VectorStore,
  threshold = 0.88,
  limit = 20,
): Promise<DuplicatePair[]> {
  const docs = await store.getAllDocuments();
  const embeddings = await store.getDocumentEmbeddings();

  if (docs.length < 2) return [];

  // 문서별 평균 임베딩 계산
  const docVecs = new Map<string, { vec: number[]; title: string; filePath: string }>();
  for (const doc of docs) {
    const vec = embeddings.get(doc.id);
    if (!vec || vec.length === 0) continue;
    docVecs.set(doc.id, { vec: Array.from(vec), title: doc.title, filePath: doc.filePath });
  }

  const ids = [...docVecs.keys()];
  const pairs: DuplicatePair[] = [];

  // O(n²) — 1,200 문서면 ~720K 비교, 수 초 이내
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = docVecs.get(ids[i])!;
      const b = docVecs.get(ids[j])!;
      const sim = cosineSimilarity(a.vec, b.vec);

      if (sim >= threshold) {
        pairs.push({
          docA: { id: ids[i], title: a.title, filePath: a.filePath },
          docB: { id: ids[j], title: b.title, filePath: b.filePath },
          similarity: Math.round(sim * 1000) / 1000,
        });
      }
    }

    if (pairs.length >= limit * 2) break; // 충분히 찾으면 중단
  }

  return pairs
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

// cosineSimilarity imported from utils/math.ts
