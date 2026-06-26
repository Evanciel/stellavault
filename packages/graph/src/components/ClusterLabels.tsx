// Cluster super-node labels — the ONE new render primitive for the cluster view.
// The Points cloud (GraphNodes) renders dots only, never text. We mount drei <Billboard>
// + <Text> for each folded super-node so the galaxy reads as labeled clusters.
//
// Gated STRICTLY on node.isCluster (≤80 billboards). NEVER render for the raw view: 8000+
// troika <Text> instances (each an SDF atlas + geometry) would tank FPS. drei <Text>/
// <Billboard> are self-disposing on unmount, so the ≤80 churn per cluster↔raw toggle is
// bounded — no hand-rolled sprite layer to dispose manually.

import { Billboard, Text } from '@react-three/drei';
import { useGraphStore } from '../stores/graph-store.js';

// Cluster palette (matches GraphNodes.tsx PALETTE order) — the label is tinted to its OWN
// cluster colour instead of stark white, so it reads as part of the dot rather than a row of
// equally-loud captions. Each is softened toward white for legibility on the dark canvas.
const PALETTE_HEX = [
  '#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#8b5cf6',
  '#14b8a6', '#e879f9', '#eab308', '#22d3ee', '#fb7185',
];

/** Lighten a hex toward white by `t` (0..1) so saturated cluster colours stay readable. */
function soften(hex: string, t: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function ClusterLabels() {
  const nodes = useGraphStore((s) => s.nodes);
  const hiddenClusters = useGraphStore((s) => s.hiddenClusters);
  const theme = useGraphStore((s) => s.theme);
  const isLight = theme === 'light';

  const clusterNodes = nodes.filter((n) => n.isCluster && n.position);
  if (clusterNodes.length === 0) return null;

  // The biggest cluster anchors the relative scale so opacity/size de-emphasise the long tail
  // of small clusters (the source of the "too many equally-white captions" clutter).
  const maxMc = Math.max(...clusterNodes.map((n) => n.memberCount ?? 1), 1);
  // Outline contrasts against whichever canvas background is active (kept thin).
  const outlineColor = isLight ? '#ffffff' : '#05050f';

  return (
    <group>
      {clusterNodes.map((n) => {
        if (hiddenClusters.has(n.clusterId)) return null;
        const mc = n.memberCount ?? 1;
        const rel = Math.sqrt(mc) / Math.sqrt(maxMc); // 0..1, bigger cluster → louder label
        // Mirror the dot's clamped sizing but a touch smaller, so the galaxy isn't all-caps soup.
        const fontSize = 3 + 0.5 * Math.min(12, Math.sqrt(mc));
        // Tint to the cluster colour — keep it COLOURFUL: only a light lift toward white on the
        // dark canvas for legibility (the dark outline carries the contrast), saturated on light.
        const base = PALETTE_HEX[n.clusterId % PALETTE_HEX.length];
        const fillColor = isLight ? base : soften(base, 0.28);
        // Small clusters recede; the few large ones carry the eye. Range ~0.45..0.95.
        const fillOpacity = 0.45 + 0.5 * rel;
        const [x, y, z] = n.position!;
        // Keep it ONE horizontal line: drei <Text> maxWidth wraps, and CJK (Korean) breaks
        // between every glyph, so a long label stacked into vertical text. Truncate instead.
        const shown = n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label;
        return (
          <Billboard key={n.id} position={[x, y + n.size * 1.5 + 6, z]}>
            <Text
              fontSize={fontSize}
              color={fillColor}
              fillOpacity={fillOpacity}
              outlineWidth={fontSize * 0.06}
              outlineColor={outlineColor}
              outlineOpacity={fillOpacity * 0.8}
              anchorX="center"
              anchorY="middle"
            >
              {`${shown} (${mc})`}
            </Text>
          </Billboard>
        );
      })}
    </group>
  );
}
