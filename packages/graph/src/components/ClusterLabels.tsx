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

export function ClusterLabels() {
  const nodes = useGraphStore((s) => s.nodes);
  const hiddenClusters = useGraphStore((s) => s.hiddenClusters);
  const theme = useGraphStore((s) => s.theme);
  const isLight = theme === 'light';

  const clusterNodes = nodes.filter((n) => n.isCluster && n.position);
  if (clusterNodes.length === 0) return null;

  // Outline contrasts against whichever canvas background is active.
  const outlineColor = isLight ? '#ffffff' : '#05050f';
  const fillColor = isLight ? '#1a1a2e' : '#e6e9ff';

  return (
    <group>
      {clusterNodes.map((n) => {
        if (hiddenClusters.has(n.clusterId)) return null;
        const mc = n.memberCount ?? 1;
        // Mirror the dot's clamped sizing (2 + min(12, sqrt(memberCount))) so big clusters get
        // bigger labels WITHOUT illegible extremes from raw-proportional fontSize.
        const fontSize = 4 + 0.6 * Math.min(12, Math.sqrt(mc));
        const [x, y, z] = n.position!;
        return (
          <Billboard key={n.id} position={[x, y + n.size * 1.5 + 6, z]}>
            <Text
              fontSize={fontSize}
              color={fillColor}
              outlineWidth={fontSize * 0.08}
              outlineColor={outlineColor}
              anchorX="center"
              anchorY="middle"
              maxWidth={160}
            >
              {`${n.label} (${mc})`}
            </Text>
          </Billboard>
        );
      })}
    </group>
  );
}
