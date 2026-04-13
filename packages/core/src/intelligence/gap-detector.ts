// Design Ref: F01 — 지식 갭 탐지기
// 클러스터 간 브릿지 노드 부족 영역 식별

import type { VectorStore } from '../store/types.js';
import type { GraphData, GraphNode, Cluster } from '../types/graph.js';

export interface KnowledgeGap {
  clusterA: string;
  clusterB: string;
  bridgeCount: number;      // 연결 노드 수 (적을수록 갭)
  suggestedTopic: string;   // 학습 추천 주제
  severity: 'high' | 'medium' | 'low';
}

export interface GapReport {
  totalClusters: number;
  totalGaps: number;
  gaps: KnowledgeGap[];
  isolatedNodes: Array<{ id: string; title: string; connections: number }>;
}

/**
 * 그래프 데이터에서 지식 갭을 탐지.
 * - 클러스터 간 연결이 약한 영역
 * - 고립된 노드 (연결 0~1개)
 */
export async function detectKnowledgeGaps(
  store: VectorStore,
  graphData?: GraphData,
): Promise<GapReport> {
  const docs = await store.getAllDocuments();
  const embeddings = await store.getDocumentEmbeddings();

  let gd: GraphData;
  if (!graphData) {
    const { buildGraphData } = await import('../api/graph-data.js');
    gd = await buildGraphData(store);
  } else {
    gd = graphData;
  }

  const { nodes, edges, clusters } = gd;

  // 1. 클러스터 간 연결 수 매트릭스
  const clusterEdges = new Map<string, number>();
  for (const edge of edges) {
    const nodeA = nodes.find(n => n.id === edge.source);
    const nodeB = nodes.find(n => n.id === edge.target);
    if (!nodeA || !nodeB || nodeA.clusterId === nodeB.clusterId) continue;

    const key = [
      Math.min(nodeA.clusterId, nodeB.clusterId),
      Math.max(nodeA.clusterId, nodeB.clusterId),
    ].join('-');
    clusterEdges.set(key, (clusterEdges.get(key) ?? 0) + 1);
  }

  // 2. 갭 식별 (클러스터 쌍 중 연결이 적은 것)
  const gaps: KnowledgeGap[] = [];
  const clusterLabels = new Map<number, string>(clusters.map(c => [c.id, c.label]));

  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const key = `${Math.min(clusters[i].id, clusters[j].id)}-${Math.max(clusters[i].id, clusters[j].id)}`;
      const bridgeCount = clusterEdges.get(key) ?? 0;

      // 연결이 3개 미만이면 갭
      if (bridgeCount < 3) {
        const labelA = clusterLabels.get(clusters[i].id) ?? `Cluster ${clusters[i].id}`;
        const labelB = clusterLabels.get(clusters[j].id) ?? `Cluster ${clusters[j].id}`;

        // 제안 주제: 두 클러스터 이름에서 추출
        const nameA = labelA.replace(/\s*\(\d+\)$/, '');
        const nameB = labelB.replace(/\s*\(\d+\)$/, '');

        gaps.push({
          clusterA: labelA,
          clusterB: labelB,
          bridgeCount,
          suggestedTopic: `${nameA} + ${nameB} 연결 지식`,
          severity: bridgeCount === 0 ? 'high' : bridgeCount < 2 ? 'medium' : 'low',
        });
      }
    }
  }

  // 3. 고립 노드 (연결 1개 이하)
  const connectionCounts = new Map<string, number>();
  for (const edge of edges) {
    connectionCounts.set(edge.source, (connectionCounts.get(edge.source) ?? 0) + 1);
    connectionCounts.set(edge.target, (connectionCounts.get(edge.target) ?? 0) + 1);
  }

  const isolatedNodes = nodes
    .filter(n => (connectionCounts.get(n.id) ?? 0) <= 1)
    .map(n => ({
      id: n.id,
      title: n.label,
      connections: connectionCounts.get(n.id) ?? 0,
    }))
    .slice(0, 20);

  return {
    totalClusters: clusters.length,
    totalGaps: gaps.filter(g => g.severity !== 'low').length,
    gaps: gaps.sort((a, b) => {
      const sev = { high: 0, medium: 1, low: 2 };
      return sev[a.severity] - sev[b.severity];
    }).slice(0, 15),
    isolatedNodes,
  };
}
