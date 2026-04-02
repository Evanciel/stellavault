// Design Ref: §3 — 별자리 뷰
// Design Ref: §8 — LOD 확장 (universe/constellation/note 3단계)
// 줌아웃(>800) → universe: 별자리 강조, 줌인(<300) → note: 개별 노드

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useGraphStore } from '../stores/graph-store.js';
import { buildConstellations, type ConstellationData } from '../lib/constellation.js';
import { useConstellationLOD } from '../hooks/useConstellationLOD.js';

function darkenHex(hex: string, factor: number): string {
  const c = hex.replace('#', '');
  const r = Math.round(parseInt(c.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(c.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(c.slice(4, 6), 16) * factor);
  return `rgb(${r},${g},${b})`;
}

export function ConstellationView() {
  const nodes = useGraphStore((s) => s.nodes);
  const clusters = useGraphStore((s) => s.clusters);
  const theme = useGraphStore((s) => s.theme);
  const isLight = theme === 'light';
  const showConstellation = useGraphStore((s) => s.showConstellation);

  if (!showConstellation) return null;
  const groupRef = useRef<THREE.Group>(null);
  const { constellationOpacity } = useConstellationLOD();
  const opacityRef = useRef(0);

  // 별자리 데이터 계산 (노드/클러스터 변경 시에만)
  const data: ConstellationData = useMemo(() => {
    if (nodes.length === 0 || clusters.length === 0) return { lines: [], labels: [] };
    return buildConstellations(nodes, clusters);
  }, [nodes, clusters]);

  // 별자리 라인 geometry
  const lineGeometries = useMemo(() => {
    const geoMap = new Map<number, THREE.BufferGeometry>();

    // 클러스터별로 라인 그룹화
    const byCluster = new Map<number, number[]>();
    for (const line of data.lines) {
      if (!byCluster.has(line.clusterId)) byCluster.set(line.clusterId, []);
      const arr = byCluster.get(line.clusterId)!;
      arr.push(line.from[0], line.from[1], line.from[2]);
      arr.push(line.to[0], line.to[1], line.to[2]);
    }

    for (const [cId, positions] of byCluster) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geoMap.set(cId, geo);
    }

    return geoMap;
  }, [data]);

  const highlightedNodeIds = useGraphStore((s) => s.highlightedNodeIds);
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const hasInteraction = highlightedNodeIds.size > 0 || !!hoveredNodeId || !!selectedNodeId;

  // LOD + 상호작용 상태에 따라 별자리 표시
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    // 상호작용 중이면 별자리를 대폭 페이드 (활성 노드에 집중)
    let targetOpacity = constellationOpacity;
    if (hasInteraction) {
      targetOpacity = isLight ? 0.03 : constellationOpacity * 0.15;
    }

    opacityRef.current += (targetOpacity - opacityRef.current) * 0.08;
    const opacity = opacityRef.current;

    group.visible = opacity > 0.01;

    group.traverse((child) => {
      if ((child as THREE.LineSegments).isLineSegments) {
        const mat = (child as THREE.LineSegments).material as THREE.LineBasicMaterial;
        mat.opacity = isLight ? opacity * 0.6 : opacity * 0.4;
      }
    });
  });

  if (data.lines.length === 0) return null;

  // 클러스터 컬러 맵
  const colorMap = new Map(clusters.map(c => [c.id, c.color]));

  return (
    <group ref={groupRef}>
      {/* 별자리 라인 — 은은한 클러스터 컬러 */}
      {[...lineGeometries.entries()].map(([cId, geo]) => (
        <lineSegments key={cId} geometry={geo}>
          <lineBasicMaterial
            color={isLight ? '#b0b8c8' : (colorMap.get(cId) ?? '#6688ff')}
            transparent
            opacity={isLight ? 0.35 : 0.12}
            depthWrite={false}
            blending={isLight ? THREE.NormalBlending : THREE.AdditiveBlending}
          />
        </lineSegments>
      ))}

      {/* 별자리 라벨 */}
      {data.labels.map((label) => (
        <ConstellationLabel
          key={label.clusterId}
          position={label.position}
          text={label.text}
          color={label.color}
          clusterId={label.clusterId}
          opacityRef={opacityRef}
        />
      ))}
    </group>
  );
}

function ConstellationLabel({ position, text, color, clusterId, opacityRef }: {
  position: [number, number, number];
  text: string;
  color: string;
  clusterId: number;
  opacityRef: React.RefObject<number>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { camera } = useThree();
  const highlightedNodeIds = useGraphStore((s) => s.highlightedNodeIds);
  const nodes = useGraphStore((s) => s.nodes);
  const themeVal = useGraphStore((s) => s.theme);
  const isLightLabel = themeVal === 'light';

  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);

  // 이 클러스터가 활성 상태인지: 하이라이트 중이거나, 선택된 노드가 이 클러스터에 속함
  const isActiveCluster =
    (highlightedNodeIds.size > 0 && nodes.some(n => n.clusterId === clusterId && highlightedNodeIds.has(n.id))) ||
    (selectedNodeId && nodes.some(n => n.id === selectedNodeId && n.clusterId === clusterId));

  useFrame(() => {
    if (ref.current) {
      // 활성 클러스터 라벨은 줌인해도 항상 보임
      const opacity = isActiveCluster ? 1 : (opacityRef.current ?? 0);
      ref.current.style.opacity = String(opacity);
    }
  });

  const handleClick = () => {
    const state = useGraphStore.getState();
    const clusterNodeIds = state.nodes
      .filter(n => n.clusterId === clusterId)
      .map(n => n.id);

    // 이미 이 클러스터가 하이라이트 중이면 해제 (토글)
    const alreadyActive = clusterNodeIds.length > 0 &&
      clusterNodeIds.every(id => state.highlightedNodeIds.has(id));

    if (alreadyActive) {
      state.setHighlightedNodes([]);
      return;
    }

    state.setHighlightedNodes(clusterNodeIds);

    // OrbitControls target을 별자리 중심으로 이동
    const controls = (window as any).__sv_controls?.current;
    if (controls) {
      const target = new THREE.Vector3(...position);
      const startTarget = controls.target.clone();
      const startPos = controls.object.position.clone();
      const dir = startPos.clone().sub(target).normalize();
      const endPos = target.clone().add(dir.multiplyScalar(350));

      let t = 0;
      function animate() {
        t += 0.025;
        if (t > 1) t = 1;
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        controls.target.lerpVectors(startTarget, target, ease);
        controls.object.position.lerpVectors(startPos, endPos, ease);
        controls.update();

        if (t < 1) requestAnimationFrame(animate);
      }
      requestAnimationFrame(animate);
    }
  };

  return (
    <Html position={position} center>
      <div
        ref={ref}
        onClick={handleClick}
        style={{
          fontSize: isLightLabel ? '13px' : '14px',
          fontWeight: isLightLabel ? 800 : 700,
          color: isLightLabel ? darkenHex(color, 0.5) : color,
          textShadow: isLightLabel
            ? '1px 1px 0 rgba(255,255,255,0.9), -1px -1px 0 rgba(255,255,255,0.9), 1px -1px 0 rgba(255,255,255,0.9), -1px 1px 0 rgba(255,255,255,0.9)'
            : `0 0 12px ${color}, 0 0 24px ${color}40`,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          opacity: 0,
          transition: 'none',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          const darkColor = isLightLabel ? darkenHex(color, 0.3) : color;
          (e.target as HTMLElement).style.textShadow = isLightLabel
            ? `0 0 4px ${darkColor}, 1px 1px 0 rgba(255,255,255,0.9), -1px -1px 0 rgba(255,255,255,0.9)`
            : `0 0 20px ${color}, 0 0 40px ${color}`;
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLElement).style.textShadow = isLightLabel
            ? '1px 1px 0 rgba(255,255,255,0.9), -1px -1px 0 rgba(255,255,255,0.9), 1px -1px 0 rgba(255,255,255,0.9), -1px 1px 0 rgba(255,255,255,0.9)'
            : `0 0 12px ${color}, 0 0 24px ${color}40`;
        }}
      >
        {text}
      </div>
    </Html>
  );
}
