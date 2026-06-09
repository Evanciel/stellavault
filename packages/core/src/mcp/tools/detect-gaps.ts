// Design Ref: §3.5 — MCP detect-gaps tool
// Plan SC: SC-04 MCP detect-gaps가 클러스터 간 갭 + 고립 노드 반환
//
// 2026-05-15: graph build + traversal 이 1215+ docs vault 에서 30s+ 걸려
// MCP request timeout 발생. gap-cache 도입 — 6h 이내 cache 면 instant.
// forceRefresh: true 옵션으로 사용자 강제 재계산 가능.

import type { Database } from 'better-sqlite3';
import type { VectorStore } from '../../store/types.js';
import { getGapReport } from '../../intelligence/gap-cache.js';

/** Codex 2026-05-15: lazy db getter — serve 의 lazy init 구조에서 server
 *  boot 시점에 store.getDb() 가 undefined 일 수 있음. handler 실행 시점에
 *  resolve 해서 ready 이후 진짜 db 인스턴스 캡처. */
export function createDetectGapsTool(store: VectorStore, getDb: () => Database) {
  return {
    name: 'detect-gaps',
    description: 'Detect knowledge gaps between topic clusters. Returns gap severity, isolated nodes, and suggested topics to bridge gaps. Result cached 6h (set forceRefresh=true to recompute).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        minSeverity: {
          type: 'string' as const,
          description: 'Minimum gap severity to include: high, medium, or low',
          enum: ['high', 'medium', 'low'],
        },
        forceRefresh: {
          type: 'boolean' as const,
          description: 'Bypass cache and recompute (expensive: 30s+ on large vaults). Default false.',
        },
      },
    },
    handler: async (args: { minSeverity?: string; forceRefresh?: boolean }) => {
      const minSeverity = args.minSeverity ?? 'medium';
      const db = getDb(); // lazy resolve — ready 이후 진짜 db 인스턴스
      const { report, fromCache, computing } = await getGapReport(store, db, { forceRefresh: args.forceRefresh });

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
              computing
                ? '갭 분석을 백그라운드에서 재계산 중입니다. 잠시 후 다시 호출하면 최신 결과가 나옵니다.'
                : filtered.length > 0
                  ? `${filtered[0].suggestedTopic} 주제로 노트를 작성하면 지식 갭을 줄일 수 있습니다.`
                  : '현재 심각한 지식 갭이 없습니다.',
            cacheStatus: computing ? (fromCache ? 'stale (recomputing in background)' : 'computing in background') : (fromCache ? 'cached' : 'fresh'),
          }, null, 2),
        }],
      };
    },
  };
}
