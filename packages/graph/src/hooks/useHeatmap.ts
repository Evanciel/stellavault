// Design Ref: §2.1 — 히트맵 데이터 fetch + 색상 계산
// Plan SC: SC-01 히트맵 60fps, SC-02 직관적 5색 gradient

import { useState, useEffect, useMemo } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

// 5-stop gradient: Cold(blue) → Normal(green) → Warm(yellow) → Hot(orange) → Fire(red)
const HEATMAP_GRADIENT: [number, [number, number, number]][] = [
  [0.0, [0.23, 0.51, 0.96]], // blue
  [0.25, [0.06, 0.72, 0.51]], // green
  [0.5, [0.96, 0.62, 0.04]], // yellow
  [0.75, [0.98, 0.57, 0.09]], // orange
  [1.0, [0.94, 0.27, 0.27]], // red
];

function lerpColor(score: number): [number, number, number] {
  const s = Math.max(0, Math.min(1, score));
  for (let i = 0; i < HEATMAP_GRADIENT.length - 1; i++) {
    const [t0, c0] = HEATMAP_GRADIENT[i];
    const [t1, c1] = HEATMAP_GRADIENT[i + 1];
    if (s >= t0 && s <= t1) {
      const t = (s - t0) / (t1 - t0);
      return [
        c0[0] + (c1[0] - c0[0]) * t,
        c0[1] + (c1[1] - c0[1]) * t,
        c0[2] + (c1[2] - c0[2]) * t,
      ];
    }
  }
  return HEATMAP_GRADIENT[HEATMAP_GRADIENT.length - 1][1];
}

export function useHeatmap() {
  const nodes = useGraphStore((s) => s.nodes);
  const showHeatmap = useGraphStore((s) => s.showHeatmap);
  const heatmapData = useGraphStore((s) => s.heatmapData);
  const setHeatmapData = useGraphStore((s) => s.setHeatmapData);
  const [loading, setLoading] = useState(false);

  // Fetch heatmap data when toggled on
  useEffect(() => {
    if (!showHeatmap) return;
    if (Object.keys(heatmapData).length > 0) return; // already loaded

    setLoading(true);
    fetch('/api/heatmap')
      .then((r) => r.json())
      .then((data) => {
        if (data.scores) setHeatmapData(data.scores);
      })
      .catch(() => {
        // Fallback: compute from node metadata
        const fallback: Record<string, number> = {};
        const now = Date.now();
        for (const n of nodes) {
          const modified = n.lastModified ? new Date(n.lastModified).getTime() : now - 86400000 * 30;
          const daysSince = (now - modified) / 86400000;
          fallback[n.id] = Math.max(0, Math.min(1, 1 - daysSince / 180));
        }
        setHeatmapData(fallback);
      })
      .finally(() => setLoading(false));
  }, [showHeatmap, nodes]);

  // Pre-compute color + size arrays for BufferAttribute
  const { heatmapColors, heatmapSizes } = useMemo(() => {
    if (!showHeatmap || nodes.length === 0) {
      return { heatmapColors: null, heatmapSizes: null };
    }

    const colors = new Float32Array(nodes.length * 3);
    const sizes = new Float32Array(nodes.length);

    for (let i = 0; i < nodes.length; i++) {
      const score = heatmapData[nodes[i].id] ?? 0.3;
      const [r, g, b] = lerpColor(score);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      sizes[i] = 0.7 + score * 0.8; // 0.7x ~ 1.5x
    }

    return { heatmapColors: colors, heatmapSizes: sizes };
  }, [showHeatmap, nodes, heatmapData]);

  return { heatmapColors, heatmapSizes, loading };
}
