// Design Ref: §5.2 — 카메라 거리 기반 LOD 레벨 결정
// Plan SC: SC-03 (줌 3단계 부드러운 전환)

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGraphStore } from '../stores/graph-store.js';

const LOD_THRESHOLDS = {
  UNIVERSE_MIN: 800,
  NOTE_MAX: 300,
  LERP_SPEED: 0.05,
} as const;

export interface LODState {
  lodLevel: 'universe' | 'constellation' | 'note';
  constellationOpacity: number;  // 0~1
  edgeOpacity: number;           // 0~1
  nodeScale: number;             // 1~3
}

export function useConstellationLOD(): LODState {
  const setLodLevel = useGraphStore((s) => s.setLodLevel);
  const opacityRef = useRef(0.5);
  const edgeOpRef = useRef(0.5);
  const scaleRef = useRef(2);
  const currentLevelRef = useRef<'universe' | 'constellation' | 'note'>('constellation');

  useFrame(({ camera }) => {
    const dist = camera.position.length();

    // Determine target LOD level
    let targetLevel: 'universe' | 'constellation' | 'note';
    let targetConstellationOp: number;
    let targetEdgeOp: number;
    let targetScale: number;

    if (dist > LOD_THRESHOLDS.UNIVERSE_MIN) {
      targetLevel = 'universe';
      targetConstellationOp = 1;
      targetEdgeOp = 0;
      targetScale = 1;
    } else if (dist < LOD_THRESHOLDS.NOTE_MAX) {
      targetLevel = 'note';
      targetConstellationOp = 0;
      targetEdgeOp = 1;
      targetScale = 3;
    } else {
      targetLevel = 'constellation';
      // Interpolate within constellation range (300~800)
      const t = (dist - LOD_THRESHOLDS.NOTE_MAX) /
        (LOD_THRESHOLDS.UNIVERSE_MIN - LOD_THRESHOLDS.NOTE_MAX);
      targetConstellationOp = t;
      targetEdgeOp = 1 - t * 0.5; // edges fade partially at distance
      targetScale = 1 + (1 - t) * 2; // 1 at far, 3 at close
    }

    // Lerp for smooth transitions
    const speed = LOD_THRESHOLDS.LERP_SPEED;
    opacityRef.current += (targetConstellationOp - opacityRef.current) * speed;
    edgeOpRef.current += (targetEdgeOp - edgeOpRef.current) * speed;
    scaleRef.current += (targetScale - scaleRef.current) * speed;

    // Update store only when level actually changes
    if (targetLevel !== currentLevelRef.current) {
      currentLevelRef.current = targetLevel;
      setLodLevel(targetLevel);
    }
  });

  return {
    lodLevel: currentLevelRef.current,
    constellationOpacity: opacityRef.current,
    edgeOpacity: edgeOpRef.current,
    nodeScale: scaleRef.current,
  };
}
