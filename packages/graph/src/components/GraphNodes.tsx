// 노드 렌더링: Points (포인트 클라우드) — 확실한 가시성 + 최고 성능
// 옵시디언 스타일: 호버 시 연결 노드 강조, 나머지 페이드

import { useRef, useMemo, useEffect, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGraphStore } from '../stores/graph-store.js';

// 원형 포인트 텍스처 생성
function createCircleTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // 그라디언트 원 (가운데 밝고 가장자리 페이드)
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const circleTexture = createCircleTexture();

// 선명한 15색 팔레트
const PALETTE = [
  [0.49, 0.23, 0.93], // #7c3aed 보라
  [0.93, 0.27, 0.60], // #ec4899 핑크
  [0.96, 0.62, 0.04], // #f59e0b 노랑
  [0.06, 0.72, 0.51], // #10b981 초록
  [0.23, 0.51, 0.96], // #3b82f6 파랑
  [0.94, 0.27, 0.27], // #ef4444 빨강
  [0.02, 0.71, 0.83], // #06b6d4 시안
  [0.52, 0.80, 0.09], // #84cc16 라임
  [0.98, 0.57, 0.09], // #f97316 오렌지
  [0.55, 0.36, 0.96], // #8b5cf6 인디고
  [0.08, 0.72, 0.65], // #14b8a6 틸
  [0.91, 0.47, 0.98], // #e879f9 퓨시아
  [0.92, 0.80, 0.03], // #eab308 골드
  [0.13, 0.83, 0.93], // #22d3ee 스카이
  [0.98, 0.45, 0.52], // #fb7185 코랄
] as number[][];

export function GraphNodes() {
  const pointsRef = useRef<THREE.Points>(null);
  const glowRef = useRef<THREE.Points>(null);

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId);
  const highlightedNodeIds = useGraphStore((s) => s.highlightedNodeIds);
  const selectNode = useGraphStore((s) => s.selectNode);
  const hoverNode = useGraphStore((s) => s.hoverNode);
  const hiddenClusters = useGraphStore((s) => s.hiddenClusters);
  const hiddenTypes = useGraphStore((s) => s.hiddenTypes);
  const timelineRange = useGraphStore((s) => s.timelineRange);
  const theme = useGraphStore((s) => s.theme);
  const isLight = theme === 'light';
  const lodLevel = useGraphStore((s) => s.lodLevel);
  const showDecayOverlay = useGraphStore((s) => s.showDecayOverlay);
  const decayData = useGraphStore((s) => s.decayData);

  // LOD nodeScale 적용 — Design Ref: §8
  const lodScale = lodLevel === 'universe' ? 0.6 : lodLevel === 'note' ? 1.2 : 1.0;

  // 검색 결과 breathing pulse 애니메이션
  const pulseTimeRef = useRef(0);

  useFrame(() => {
    if (highlightedNodeIds.size === 0) { pulseTimeRef.current = 0; return; }

    const pts = pointsRef.current;
    if (!pts || nodes.length === 0) return;
    const sizeAttr = pts.geometry.getAttribute('size') as THREE.BufferAttribute;
    if (!sizeAttr) return;

    pulseTimeRef.current += 0.04;
    // sin wave breathing: 1.4x ~ 2.2x 반복
    const breath = 1.4 + Math.sin(pulseTimeRef.current) * 0.4;

    for (let i = 0; i < nodes.length; i++) {
      if (highlightedNodeIds.has(nodes[i].id)) {
        const baseSize = 4 + nodes[i].size * 3;
        sizeAttr.setX(i, baseSize * breath);
      }
    }
    sizeAttr.needsUpdate = true;
  });

  // 호버/선택 시 이웃 노드
  const connectedIds = useMemo(() => {
    const activeId = hoveredNodeId || selectedNodeId;
    if (!activeId) return null;
    const ids = new Set<string>();
    ids.add(activeId);
    for (const e of edges) {
      if (e.source === activeId) ids.add(e.target);
      if (e.target === activeId) ids.add(e.source);
    }
    return ids;
  }, [hoveredNodeId, selectedNodeId, edges]);

  // 위치 + 색상 + 크기 버퍼
  const { positions, colors, sizes, glowSizes } = useMemo(() => {
    const n = nodes.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const sz = new Float32Array(n);
    const gsz = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      const [x, y, z] = node.position ?? [0, 0, 0];
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      const pal = PALETTE[node.clusterId % PALETTE.length];
      if (isLight) {
        // Light mode: 모노톤 — 크기 무관하게 일관된 진한 회색 (모든 노드 가시성 확보)
        const gray = 0.32 + (1 - Math.min(node.size / 7, 1)) * 0.12;
        col[i * 3] = gray;
        col[i * 3 + 1] = gray;
        col[i * 3 + 2] = gray + 0.02;
      } else {
        // Dark mode: 기존 팔레트 + 밝기 부스트
        const bright = Math.min((node.size - 1) / 6, 1) * 0.4;
        col[i * 3] = Math.min(pal[0] + bright, 1);
        col[i * 3 + 1] = Math.min(pal[1] + bright, 1);
        col[i * 3 + 2] = Math.min(pal[2] + bright, 1);
      }

      sz[i] = (3 + node.size * 4) * lodScale;
      gsz[i] = (8 + node.size * 12) * lodScale;
    }

    return { positions: pos, colors: col, sizes: sz, glowSizes: gsz };
  }, [nodes, isLight, lodScale]);

  // 호버/선택 시 컬러 + 크기 업데이트 (극적 효과)
  useEffect(() => {
    const pts = pointsRef.current;
    const glow = glowRef.current;
    if (!pts || nodes.length === 0) return;

    const colAttr = pts.geometry.getAttribute('color') as THREE.BufferAttribute;
    const sizeAttr = pts.geometry.getAttribute('size') as THREE.BufferAttribute;
    const glowColAttr = glow?.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    const glowSizeAttr = glow?.geometry.getAttribute('size') as THREE.BufferAttribute | undefined;
    if (!colAttr || !sizeAttr) return;

    const hasPulse = highlightedNodeIds.size > 0;
    const hasActive = connectedIds !== null && !hasPulse;
    const currentTheme = useGraphStore.getState().theme;
    const isLightMode = currentTheme === 'light';
    // hiddenClusters는 컴포넌트 레벨에서 subscribe

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const pal = PALETTE[node.clusterId % PALETTE.length];
      let r = pal[0], g = pal[1], b = pal[2];
      let sz = 4 + node.size * 3;
      let gsz = 12 + node.size * 8;

      // 감쇠 오버레이 — Design Ref: §5.1
      if (showDecayOverlay && !hasPulse && !hasActive) {
        const rVal = decayData[node.id] ?? 1.0; // R값 (없으면 1.0 = 건강)
        if (rVal < 0.7) {
          const fade = Math.max(rVal, 0.1);
          if (isLightMode) {
            r = 0.5 + (1 - fade) * 0.4; g = 0.5 + (1 - fade) * 0.4; b = 0.5 + (1 - fade) * 0.4;
          } else {
            r *= fade; g *= fade; b *= fade;
          }
          sz *= (0.3 + fade * 0.7);
          gsz *= (0.2 + fade * 0.5);
        }
        colAttr.setXYZ(i, r, g, b);
        sizeAttr.setX(i, sz);
        if (glowColAttr) glowColAttr.setXYZ(i, r, g, b);
        if (glowSizeAttr) glowSizeAttr.setX(i, gsz);
        continue;
      }

      // 타임라인 범위 필터
      if (timelineRange && node.lastModified) {
        const ms = new Date(node.lastModified).getTime();
        if (ms < timelineRange[0] || ms > timelineRange[1]) {
          r *= 0.04; g *= 0.04; b *= 0.04;
          sz *= 0.2;
          gsz *= 0.1;
          colAttr.setXYZ(i, r, g, b);
          sizeAttr.setX(i, sz);
          if (glowColAttr) glowColAttr.setXYZ(i, r, g, b);
          if (glowSizeAttr) glowSizeAttr.setX(i, gsz);
          continue;
        }
      }

      // type/source 숨김
      const nodeSource = node.source ?? 'local';
      const nodeType = node.type ?? 'note';
      if (hiddenTypes.has(`source:${nodeSource}`) || hiddenTypes.has(`type:${nodeType}`)) {
        r *= 0.02; g *= 0.02; b *= 0.02;
        sz *= 0.15;
        gsz *= 0.1;
        colAttr.setXYZ(i, r, g, b);
        sizeAttr.setX(i, sz);
        if (glowColAttr) glowColAttr.setXYZ(i, r, g, b);
        if (glowSizeAttr) glowSizeAttr.setX(i, gsz);
        continue;
      }

      // 클러스터 숨김
      if (hiddenClusters.has(node.clusterId)) {
        r *= 0.02; g *= 0.02; b *= 0.02;
        sz *= 0.15;
        gsz *= 0.1;
        colAttr.setXYZ(i, r, g, b);
        sizeAttr.setX(i, sz);
        if (glowColAttr) glowColAttr.setXYZ(i, r, g, b);
        if (glowSizeAttr) glowSizeAttr.setX(i, gsz);
        continue;
      }

      if (hasPulse) {
        if (highlightedNodeIds.has(node.id)) {
          if (isLightMode) {
            // Light: 하이라이트 시 클러스터 컬러 드러남 (모노톤→컬러)
            r = pal[0] * 0.7; g = pal[1] * 0.7; b = pal[2] * 0.7;
            sz *= 1.8;
          } else {
            r = Math.min(r * 1.6, 1);
            g = Math.min(g * 1.6, 1);
            b = Math.min(b * 1.6, 1);
            sz *= 1.6;
          }
          gsz = isLightMode ? 0 : gsz * 2;
        } else {
          if (isLightMode) {
            r = 0.90; g = 0.90; b = 0.91;
            sz *= 0.15;
          } else {
            r *= 0.03; g *= 0.03; b *= 0.03;
            sz *= 0.3;
            gsz *= 0.2;
          }
          gsz = isLightMode ? 0 : gsz;
        }
      } else if (node.id === hoveredNodeId) {
        if (isLightMode) {
          // Light: 호버 시 클러스터 컬러로 전환
          r = pal[0] * 0.65; g = pal[1] * 0.65; b = pal[2] * 0.65;
        } else {
          r = 1; g = 1; b = 1;
        }
        sz *= 2.5;
        gsz = isLightMode ? 0 : gsz * 2.5;
      } else if (node.id === selectedNodeId) {
        if (isLightMode) {
          // Light: 선택 시 클러스터 컬러
          r = pal[0] * 0.6 + 0.15;
          g = pal[1] * 0.6 + 0.15;
          b = pal[2] * 0.6 + 0.15;
        } else {
          r = r * 0.3 + 0.7;
          g = g * 0.3 + 0.7;
          b = b * 0.3 + 0.7;
        }
        sz *= 2;
        gsz = isLightMode ? 0 : gsz * 2;
      } else if (hasActive && connectedIds!.has(node.id)) {
        if (isLightMode) {
          // Light: 연결 노드도 컬러 드러남
          r = pal[0] * 0.7; g = pal[1] * 0.7; b = pal[2] * 0.7;
        } else {
          r = Math.min(r * 1.6, 1);
          g = Math.min(g * 1.6, 1);
          b = Math.min(b * 1.6, 1);
        }
        sz *= 1.5;
        gsz = isLightMode ? 0 : gsz * 1.8;
      } else if (hasActive && !connectedIds!.has(node.id)) {
        if (isLightMode) {
          r = 0.90; g = 0.90; b = 0.91;
          sz *= 0.15;
          gsz = 0;
        } else {
          r *= 0.03; g *= 0.03; b *= 0.03;
          sz *= 0.4;
          gsz *= 0.3;
        }
      }

      colAttr.setXYZ(i, r, g, b);
      sizeAttr.setX(i, sz);
      if (glowColAttr) glowColAttr.setXYZ(i, r, g, b);
      if (glowSizeAttr) glowSizeAttr.setX(i, gsz);
    }

    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    if (glowColAttr) glowColAttr.needsUpdate = true;
    if (glowSizeAttr) glowSizeAttr.needsUpdate = true;
  }, [nodes, hoveredNodeId, selectedNodeId, connectedIds, highlightedNodeIds, hiddenClusters, hiddenTypes, timelineRange, showDecayOverlay, decayData]);

  // Raycaster로 호버/클릭 처리
  const handlePointerMove = useCallback((e: any) => {
    e.stopPropagation();
    if (e.index !== undefined && e.index < nodes.length) {
      hoverNode(nodes[e.index].id);
      document.body.style.cursor = 'pointer';
    }
  }, [nodes, hoverNode]);

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    if (e.index !== undefined && e.index < nodes.length) {
      selectNode(nodes[e.index].id);
    }
  }, [nodes, selectNode]);

  const handlePointerOut = useCallback(() => {
    hoverNode(null);
    document.body.style.cursor = 'default';
  }, [hoverNode]);

  if (nodes.length === 0) return null;

  return (
    <group>
      {/* 글로우 레이어 (큰 반투명 포인트) — light mode에서는 그림자 스타일 */}
      <points ref={glowRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[new Float32Array(colors), 3]} />
          <bufferAttribute attach="attributes-size" args={[glowSizes, 1]} />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          transparent
          opacity={isLight ? 0.06 : 0.25}
          depthWrite={false}
          blending={isLight ? THREE.NormalBlending : THREE.AdditiveBlending}
          sizeAttenuation
          size={isLight ? 10 : 18}
          map={circleTexture}
          alphaTest={0.05}
        />
      </points>

      {/* 코어 노드 */}
      <points
        ref={pointsRef}
        onClick={handleClick}
        onPointerOver={handlePointerMove}
        onPointerOut={handlePointerOut}
      >
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
          <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          transparent
          opacity={isLight ? 1.0 : 0.95}
          depthWrite={false}
          sizeAttenuation
          size={isLight ? 8 : 6}
          map={circleTexture}
          alphaTest={0.01}
        />
      </points>
    </group>
  );
}
