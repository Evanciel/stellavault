// Cluster super-nodes rendered as PLANETS — a lit sphere (body) + a faint additive shell
// (atmosphere) per folded cluster, so the cluster galaxy reads as a little solar system
// instead of flat dots. Gated on node.isCluster (≤80 spheres), cluster-view only; the raw
// 8000-node view stays a Points cloud (never mount this for it).
//
// Purely decorative: raycast is disabled on every mesh so hover/click/drilldown keep flowing
// through the existing GraphNodes Points raycaster (the super-node keeps a tiny core point).

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGraphStore } from '../stores/graph-store.js';

// Matches GraphNodes.tsx PALETTE order (the dot/label colour of each cluster).
const PALETTE_HEX = [
  '#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#8b5cf6',
  '#14b8a6', '#e879f9', '#eab308', '#22d3ee', '#fb7185',
];

const NOOP_RAYCAST = () => null;

export function ClusterPlanets() {
  const nodes = useGraphStore((s) => s.nodes);
  const hiddenClusters = useGraphStore((s) => s.hiddenClusters);
  const groupRef = useRef<THREE.Group>(null);

  // Gentle global spin gives the planets a sense of life without per-mesh state.
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    for (const child of groupRef.current.children) child.rotation.y += delta * 0.15;
  });

  const planets = nodes.filter((n) => n.isCluster && n.position && !hiddenClusters.has(n.clusterId));
  if (planets.length === 0) return null;

  return (
    <group ref={groupRef}>
      {planets.map((n) => {
        const color = PALETTE_HEX[n.clusterId % PALETTE_HEX.length];
        // Body radius from the same clamped size as the dot/label (2 + min(12, sqrt(mc))).
        const radius = 1.4 + (n.size ?? 3) * 0.85;
        const [x, y, z] = n.position!;
        return (
          <group key={n.id} position={[x, y, z]}>
            {/* planet body — lit by the scene's point lights for a day/night terminator */}
            <mesh raycast={NOOP_RAYCAST}>
              <sphereGeometry args={[radius, 28, 28]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={0.22}
                roughness={0.62}
                metalness={0.12}
              />
            </mesh>
            {/* atmosphere — a faint additive back-side shell that haloes the rim */}
            <mesh raycast={NOOP_RAYCAST} scale={1.28}>
              <sphereGeometry args={[radius, 24, 24]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.16}
                side={THREE.BackSide}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
