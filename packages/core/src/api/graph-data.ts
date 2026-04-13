// Design Ref: §4.2 — Graph Data 생성 알고리즘
// Design Ref: §6.2 — K-Means 클러스터링

import type { VectorStore } from '../store/types.js';
import type { GraphNode, GraphEdge, Cluster, GraphData } from '../types/graph.js';
import { createHash } from 'node:crypto';
import { cosineSimilarity, euclideanDist, normalizeVector, dotProduct } from '../utils/math.js';

const CLUSTER_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4',
  '#84cc16', '#e879f9', '#22d3ee', '#a3e635', '#fb923c',
];

export type GraphMode = 'semantic' | 'folder';

export interface BuildGraphOptions {
  mode?: GraphMode;            // default: 'semantic'
  edgeThreshold?: number;      // default: 0.15
  maxEdgesPerNode?: number;    // default: 5
  clusterCount?: number;       // 0 = auto (Elbow)
}

export async function buildGraphData(
  store: VectorStore,
  options: BuildGraphOptions = {},
): Promise<GraphData> {
  const {
    edgeThreshold = 0.15,
    maxEdgesPerNode = 5,
  } = options;

  // 1. 모든 문서 + 임베딩 로드
  const [docs, embeddings] = await Promise.all([
    store.getAllDocuments(),
    store.getDocumentEmbeddings(),
  ]);

  // 2. k-NN 엣지 생성 — 전략 선택
  const edges: GraphEdge[] = [];
  const edgeCounts = new Map<string, number>();
  const USE_HNSW_THRESHOLD = 200; // N > 200이면 sqlite-vec KNN 사용

  const docsWithVecs = docs.filter(d => embeddings.has(d.id));

  if (docsWithVecs.length > USE_HNSW_THRESHOLD) {
    // === HNSW 전략: O(n · K · log n) via sqlite-vec ===
    for (const doc of docsWithVecs) {
      const vec = embeddings.get(doc.id)!;
      const neighbors = await store.findDocumentNeighbors(vec, maxEdgesPerNode + 1);

      for (const { documentId: targetId, similarity } of neighbors) {
        if (targetId === doc.id) continue;
        if (similarity < edgeThreshold) continue;
        const edgeKey = [doc.id, targetId].sort().join(':');
        if (!edgeCounts.has(edgeKey)) {
          edges.push({ source: doc.id, target: targetId, weight: similarity });
          edgeCounts.set(edgeKey, 1);
        }
      }
    }
  } else {
    // === Brute-force 전략: O(n²/2) — 소규모 vault에서 더 빠름 ===
    const normalizedVecs = new Map<string, number[]>();
    for (const doc of docsWithVecs) {
      normalizedVecs.set(doc.id, normalizeVector([...embeddings.get(doc.id)!]));
    }

    const docIds = [...normalizedVecs.keys()];
    const vecArray = docIds.map(id => normalizedVecs.get(id)!);
    const n = docIds.length;

    const neighbors: Array<Array<{ peer: number; sim: number }>> = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sim = dotProduct(vecArray[i], vecArray[j]);
        if (sim >= edgeThreshold) {
          neighbors[i].push({ peer: j, sim });
          neighbors[j].push({ peer: i, sim });
        }
      }
    }

    for (let i = 0; i < n; i++) {
      neighbors[i].sort((a, b) => b.sim - a.sim);
      for (const { peer: j, sim } of neighbors[i].slice(0, maxEdgesPerNode)) {
        const edgeKey = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (!edgeCounts.has(edgeKey)) {
          edges.push({ source: docIds[i], target: docIds[j], weight: sim });
          edgeCounts.set(edgeKey, 1);
        }
      }
    }
  }

  // 3. 클러스터링 — 모드에 따라 분기
  const mode = options.mode ?? 'semantic';
  let assignmentMap: Map<string, number>;
  let clusters: Cluster[];

  if (mode === 'folder') {
    // 폴더 기반: 최상위 폴더를 클러스터로 사용
    const folderMap = new Map<string, number>();
    const folderNames: string[] = [];

    for (const doc of docs) {
      const topFolder = doc.filePath.split('/')[0] ?? 'root';
      if (!folderMap.has(topFolder)) {
        folderMap.set(topFolder, folderNames.length);
        folderNames.push(topFolder);
      }
    }

    assignmentMap = new Map<string, number>();
    for (const doc of docs) {
      const topFolder = doc.filePath.split('/')[0] ?? 'root';
      assignmentMap.set(doc.id, folderMap.get(topFolder)!);
    }

    // 폴더별 클러스터
    const folderCounts = new Map<number, number>();
    for (const [, cId] of assignmentMap) {
      folderCounts.set(cId, (folderCounts.get(cId) ?? 0) + 1);
    }

    clusters = folderNames.map((name, i) => ({
      id: i,
      label: name.replace(/^\d+_/, ''),  // "04_Projects" → "Projects"
      color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
      nodeCount: folderCounts.get(i) ?? 0,
    }));
  } else {
    // 시맨틱 기반: K-means
    const docIds = docs.filter(d => embeddings.has(d.id)).map(d => d.id);
    const vectors = docIds.map(id => embeddings.get(id)!);
    const k = Math.min(Math.max(5, Math.round(Math.sqrt(docIds.length / 5))), 10);
    const assignments = kMeans(vectors, k);

    // 클러스터별 문서 수집 (id + title)
    const clusterDocInfos = new Map<number, Array<{ id: string; title: string }>>();
    for (let i = 0; i < docIds.length; i++) {
      const cId = assignments[i];
      if (!clusterDocInfos.has(cId)) clusterDocInfos.set(cId, []);
      const doc = docs.find(d => d.id === docIds[i]);
      if (doc) clusterDocInfos.get(cId)!.push({ id: doc.id, title: doc.title });
    }

    // 엣지 기반 연결 수 계산 (대표 노드 선정용)
    const connCounts = new Map<string, number>();
    for (const e of edges) {
      connCounts.set(e.source, (connCounts.get(e.source) ?? 0) + 1);
      connCounts.set(e.target, (connCounts.get(e.target) ?? 0) + 1);
    }

    clusters = [];
    for (const [cId, docInfos] of clusterDocInfos) {
      // 가장 연결이 많은 노드 = 대표 노드
      const sorted = [...docInfos].sort((a, b) =>
        (connCounts.get(b.id) ?? 0) - (connCounts.get(a.id) ?? 0)
      );
      const representative = sorted[0]?.title ?? 'Cluster';
      clusters.push({
        id: cId,
        label: `${representative} (${docInfos.length})`,
        color: CLUSTER_COLORS[cId % CLUSTER_COLORS.length],
        nodeCount: docInfos.length,
      });
    }

    assignmentMap = new Map<string, number>();
    for (let i = 0; i < docIds.length; i++) {
      assignmentMap.set(docIds[i], assignments[i]);
    }
  }

  // 4. 노드 생성

  const connectionCounts = new Map<string, number>();
  for (const edge of edges) {
    connectionCounts.set(edge.source, (connectionCounts.get(edge.source) ?? 0) + 1);
    connectionCounts.set(edge.target, (connectionCounts.get(edge.target) ?? 0) + 1);
  }
  const maxConnections = Math.max(1, ...connectionCounts.values());

  const nodes: GraphNode[] = docs.map(doc => {
    const conns = connectionCounts.get(doc.id) ?? 0;
    const ratio = conns / maxConnections; // 0~1
    // 지수 스케일: 상위 노드만 극적으로 커짐 (ratio^0.5 → 중심부 강조)
    const size = 1 + 6 * Math.pow(ratio, 0.5);
    return {
      id: doc.id,
      label: doc.title.replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s*-\s*YouTube$/, '').slice(0, 40),
      filePath: doc.filePath,
      tags: doc.tags,
      clusterId: assignmentMap.get(doc.id) ?? 0,
      size,
      source: doc.source ?? 'local',
      type: doc.type ?? 'note',
      lastModified: doc.lastModified,
    };
  });

  // 5. cache key
  const cacheKey = createHash('md5')
    .update(JSON.stringify({ nodeCount: nodes.length, edgeCount: edges.length }))
    .digest('hex')
    .slice(0, 8);

  return {
    nodes,
    edges,
    clusters,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      clusterCount: clusters.length,
    },
  };
}

// --- 유틸리티 ---

// Imported from shared utils — see utils/math.ts

function kMeans(vectors: number[][], k: number, maxIter: number = 50): number[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0].length;

  // K-means++ 초기화
  const centroids: number[][] = [vectors[Math.floor(Math.random() * vectors.length)].slice()];
  for (let c = 1; c < k; c++) {
    const dists = vectors.map(v => {
      let minD = Infinity;
      for (const cent of centroids) {
        const d = euclideanDist(v, cent);
        if (d < minD) minD = d;
      }
      return minD;
    });
    const totalDist = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalDist;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) { centroids.push(vectors[i].slice()); break; }
    }
    if (centroids.length <= c) centroids.push(vectors[Math.floor(Math.random() * vectors.length)].slice());
  }

  const assignments = new Array<number>(vectors.length).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;

    // Assign
    for (let i = 0; i < vectors.length; i++) {
      let bestC = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = euclideanDist(vectors[i], centroids[c]);
        if (d < bestD) { bestD = d; bestC = c; }
      }
      if (assignments[i] !== bestC) { assignments[i] = bestC; changed = true; }
    }

    if (!changed) break;

    // Update centroids — accumulate in-place instead of filter + reduce per cluster
    const sums = Array.from({ length: k }, () => new Float64Array(dims));
    const counts = new Uint32Array(k);
    for (let i = 0; i < vectors.length; i++) {
      const c = assignments[i];
      counts[c]++;
      const s = sums[c], v = vectors[i];
      for (let d = 0; d < dims; d++) s[d] += v[d];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      const s = sums[c];
      for (let d = 0; d < dims; d++) centroids[c][d] = s[d] / counts[c];
    }
  }

  return assignments;
}

// euclideanDist imported from shared utils

function extractClusterLabel(titles: string[]): string {
  // 제목에서 빈출 단어 추출 (2글자 이상)
  const wordCounts = new Map<string, number>();
  const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was', 'be']);
  for (const title of titles) {
    const words = title.replace(/[^\w가-힣\s]/g, '').split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w.toLowerCase()));
    const seen = new Set<string>();
    for (const w of words) {
      if (!seen.has(w)) { wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1); seen.add(w); }
    }
  }
  const sorted = [...wordCounts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 3).map(([w]) => w).join(', ') || `Cluster`;
}
