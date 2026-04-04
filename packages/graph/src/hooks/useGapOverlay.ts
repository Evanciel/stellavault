// Design Ref: §3.1 — 갭 데이터 fetch + 시각 처리
// Plan SC: SC-03 갭 시각화 정확성, SC-04 MCP detect-gaps

import { useState, useEffect, useMemo } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

export function useGapOverlay() {
  const nodes = useGraphStore((s) => s.nodes);
  const clusters = useGraphStore((s) => s.clusters);
  const showGaps = useGraphStore((s) => s.showGaps);
  const gapData = useGraphStore((s) => s.gapData);
  const setGapData = useGraphStore((s) => s.setGapData);
  const [loading, setLoading] = useState(false);

  // Fetch gap data when toggled on
  useEffect(() => {
    if (!showGaps) return;
    if (gapData) return; // already loaded

    setLoading(true);
    fetch('/api/gaps')
      .then((r) => r.json())
      .then((report) => {
        const isolatedNodeIds = new Set<string>(
          (report.isolatedNodes ?? []).map((n: any) => n.id)
        );
        const gaps = (report.gaps ?? []).map((g: any) => {
          // Find cluster IDs from labels
          const clusterA = clusters.find((c) => c.label === g.clusterA);
          const clusterB = clusters.find((c) => c.label === g.clusterB);
          return {
            clusterIdA: clusterA?.id ?? -1,
            clusterIdB: clusterB?.id ?? -1,
            bridgeCount: g.bridgeCount,
            severity: g.severity as 'high' | 'medium' | 'low',
          };
        });
        setGapData({ gaps, isolatedNodeIds });
      })
      .catch(() => setGapData({ gaps: [], isolatedNodeIds: new Set() }))
      .finally(() => setLoading(false));
  }, [showGaps, clusters]);

  // Compute cluster center positions for gap lines
  const gapLines = useMemo(() => {
    if (!showGaps || !gapData) return [];

    // Cluster center = average position of nodes in cluster
    const clusterCenters = new Map<number, [number, number, number]>();
    const clusterCounts = new Map<number, number>();

    for (const n of nodes) {
      const pos = n.position ?? [0, 0, 0];
      const prev = clusterCenters.get(n.clusterId) ?? [0, 0, 0];
      const count = (clusterCounts.get(n.clusterId) ?? 0) + 1;
      clusterCenters.set(n.clusterId, [
        prev[0] + pos[0],
        prev[1] + pos[1],
        prev[2] + pos[2],
      ]);
      clusterCounts.set(n.clusterId, count);
    }

    // Normalize to average
    for (const [id, sum] of clusterCenters) {
      const count = clusterCounts.get(id) ?? 1;
      clusterCenters.set(id, [sum[0] / count, sum[1] / count, sum[2] / count]);
    }

    return gapData.gaps
      .filter((g) => g.severity !== 'low')
      .map((g) => ({
        from: clusterCenters.get(g.clusterIdA) ?? [0, 0, 0] as [number, number, number],
        to: clusterCenters.get(g.clusterIdB) ?? [0, 0, 0] as [number, number, number],
        severity: g.severity,
      }));
  }, [showGaps, gapData, nodes]);

  return { gapLines, loading };
}
