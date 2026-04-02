// Knowledge Semantic Versioning (F-A13)
// Track how a note's MEANING changes over time via embedding drift

export interface SemanticVersion {
  documentId: string;
  timestamp: string;
  embeddingHash: string; // first 8 chars of embedding vector hash
  drift: number; // cosine distance from previous version (0 = identical, 2 = opposite)
}

export interface SemanticChangelog {
  documentId: string;
  title: string;
  versions: SemanticVersion[];
  totalDrift: number; // cumulative semantic drift
  stability: number; // 0-1, how stable the meaning has been
}

/**
 * Compute semantic drift between two embedding vectors.
 * Returns cosine distance (0 = identical, 1 = orthogonal, 2 = opposite)
 */
export function computeSemanticDrift(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    na += vecA[i] * vecA[i];
    nb += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  const similarity = denom === 0 ? 0 : dot / denom;
  return 1 - similarity; // cosine distance
}

/**
 * Hash an embedding vector for quick comparison
 */
export function hashEmbedding(vec: number[]): string {
  let hash = 0;
  for (let i = 0; i < Math.min(vec.length, 50); i++) {
    hash = ((hash << 5) - hash + Math.round(vec[i] * 10000)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

/**
 * Analyze semantic stability of a document given its embedding history.
 * In practice, we compare current embedding vs initial embedding to measure total drift.
 */
export function analyzeSemanticStability(
  currentVec: number[],
  title: string,
  documentId: string,
): SemanticChangelog {
  // Single-point analysis (no history yet — foundation for future multi-version tracking)
  const now = new Date().toISOString();
  const hash = hashEmbedding(currentVec);

  return {
    documentId,
    title,
    versions: [{
      documentId,
      timestamp: now,
      embeddingHash: hash,
      drift: 0,
    }],
    totalDrift: 0,
    stability: 1.0,
  };
}

/**
 * Compare two sets of embeddings to find documents with the most semantic drift.
 * Useful for "what changed the most since last index?"
 */
export function findMostDrifted(
  previousEmbeddings: Map<string, number[]>,
  currentEmbeddings: Map<string, number[]>,
  titles: Map<string, string>,
  limit = 10,
): Array<{ documentId: string; title: string; drift: number }> {
  const drifts: Array<{ documentId: string; title: string; drift: number }> = [];

  for (const [docId, currentVec] of currentEmbeddings) {
    const prevVec = previousEmbeddings.get(docId);
    if (!prevVec) continue;

    const drift = computeSemanticDrift(prevVec, currentVec);
    if (drift > 0.01) { // ignore trivial changes
      drifts.push({ documentId: docId, title: titles.get(docId) ?? docId, drift: Math.round(drift * 1000) / 1000 });
    }
  }

  return drifts.sort((a, b) => b.drift - a.drift).slice(0, limit);
}
