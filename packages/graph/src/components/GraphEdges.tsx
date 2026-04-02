// 시냅스 엣지 — hover 강조 + pulse + 줌아웃 시 페이드

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGraphStore } from '../stores/graph-store.js';

export function GraphEdges() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const highlightedNodeIds = useGraphStore((s) => s.highlightedNodeIds);

  const theme = useGraphStore((s) => s.theme);
  const isLight = theme === 'light';
  const activeId = hoveredNodeId || selectedNodeId;
  const hasPulse = highlightedNodeIds.size > 0;

  const dimMatRef = useRef<THREE.LineBasicMaterial>(null);

  const { litGeo, dimGeo } = useMemo(() => {
    if (edges.length === 0 || nodes.length === 0) return { litGeo: null, dimGeo: null };

    const nodeMap = new Map(nodes.map((n) => [n.id, n.position ?? [0, 0, 0]]));
    const litPos: number[] = [];
    const dimPos: number[] = [];

    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) continue;

      let isLit = false;
      if (hasPulse) {
        // 하이라이트: 양쪽 다 하이라이트된 엣지만 밝게
        isLit = highlightedNodeIds.has(edge.source) && highlightedNodeIds.has(edge.target);
      } else if (activeId) {
        isLit = edge.source === activeId || edge.target === activeId;
      }

      const arr = isLit ? litPos : dimPos;
      arr.push(src[0], src[1], src[2], tgt[0], tgt[1], tgt[2]);
    }

    const make = (p: number[]) => {
      if (p.length === 0) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      return g;
    };

    return { litGeo: make(litPos), dimGeo: make(dimPos) };
  }, [nodes, edges, activeId, hasPulse, highlightedNodeIds]);

  const hasInteraction = hasPulse || !!activeId;

  // 줌아웃 시 엣지 페이드아웃 (별자리 뷰와 충돌 방지)
  useFrame(({ camera }) => {
    if (!dimMatRef.current) return;
    const dist = camera.position.length();
    let fade = 1;
    if (dist > 500) fade = 0;
    else if (dist > 300) fade = 1 - (dist - 300) / 200;

    const baseOpacity = isLight
      ? (hasInteraction ? 0.03 : 0.35)
      : (hasInteraction ? 0.005 : 0.1);
    dimMatRef.current.opacity = baseOpacity * fade;
  });

  return (
    <group>
      {dimGeo && (
        <lineSegments geometry={dimGeo}>
          <lineBasicMaterial
            ref={dimMatRef}
            color={isLight ? '#8890a0' : '#4466aa'}
            transparent
            opacity={isLight ? 0.3 : 0.1}
            depthWrite={false}
            blending={isLight ? THREE.NormalBlending : THREE.AdditiveBlending}
          />
        </lineSegments>
      )}

      {litGeo && (
        <lineSegments geometry={litGeo}>
          <lineBasicMaterial
            color={isLight ? (hasPulse ? '#4466cc' : '#3355aa') : (hasPulse ? '#66ddff' : '#6699cc')}
            transparent
            opacity={isLight ? (hasPulse ? 0.5 : 0.6) : (hasPulse ? 0.08 : 0.2)}
            depthWrite={false}
            blending={isLight ? THREE.NormalBlending : THREE.AdditiveBlending}
          />
        </lineSegments>
      )}
    </group>
  );
}
