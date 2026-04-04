// Design Ref: §3.5 — MCP detect-gaps tool
// Plan SC: SC-04 MCP detect-gaps가 클러스터 간 갭 + 고립 노드 반환

import type { VectorStore } from '../../store/types.js';
import { detectKnowledgeGaps } from '../../intelligence/gap-detector.js';

export function createDetectGapsTool(store: VectorStore) {
  return {
    name: 'detect-gaps',
    description: 'Detect knowledge gaps between topic clusters. Returns gap severity, isolated nodes, and suggested topics to bridge gaps.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        minSeverity: {
          type: 'string' as const,
          description: 'Minimum gap severity to include: high, medium, or low',
          enum: ['high', 'medium', 'low'],
        },
      },
    },
    handler: async (args: { minSeverity?: string }) => {
      const minSeverity = args.minSeverity ?? 'medium';
      const report = await detectKnowledgeGaps(store);

      const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const threshold = sevOrder[minSeverity] ?? 1;

      const filtered = report.gaps.filter(
        (g) => sevOrder[g.severity] <= threshold
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            totalClusters: report.totalClusters,
            totalGaps: filtered.length,
            gaps: filtered.map((g) => ({
              clusterA: g.clusterA,
              clusterB: g.clusterB,
              bridgeCount: g.bridgeCount,
              severity: g.severity,
              suggestedTopic: g.suggestedTopic,
            })),
            isolatedNodes: report.isolatedNodes.slice(0, 10),
            suggestion:
              filtered.length > 0
                ? `${filtered[0].suggestedTopic} 주제로 노트를 작성하면 지식 갭을 줄일 수 있습니다.`
                : '현재 심각한 지식 갭이 없습니다.',
          }, null, 2),
        }],
      };
    },
  };
}
