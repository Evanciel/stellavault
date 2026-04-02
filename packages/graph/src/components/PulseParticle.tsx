// 빛 입자 + 궤적 — 작고 화려한 입자가 부드럽게 이동, 지나간 경로 표시

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGraphStore } from '../stores/graph-store.js';
import { pulseData } from '../hooks/usePulse.js';

const TRAIL_LENGTH = 60; // 궤적 점 개수

export function PulseAnimator() {
  const coreRef = useRef<THREE.Points>(null);
  const glowRef = useRef<THREE.Points>(null);
  const trailRef = useRef<THREE.Line>(null);
  const theme = useGraphStore((s) => s.theme);
  const isLight = theme === 'light';

  const stepRef = useRef(0);
  const tRef = useRef(0);
  const litRef = useRef<string[]>([]);
  const flashRef = useRef(0);

  // 궤적 위치 버퍼 (ring buffer)
  const trailBuf = useRef(new Float32Array(TRAIL_LENGTH * 3));
  const trailHead = useRef(0);
  const trailCount = useRef(0);

  // 원형 텍스처 (노드와 동일 스타일)
  const texture = useRef<THREE.Texture | null>(null);
  if (!texture.current) {
    const sz = 64;
    const cv = document.createElement('canvas');
    cv.width = sz; cv.height = sz;
    const ctx = cv.getContext('2d')!;
    const g = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(180,220,255,0.9)');
    g.addColorStop(0.5, 'rgba(100,180,255,0.3)');
    g.addColorStop(1, 'rgba(60,120,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, sz, sz);
    texture.current = new THREE.CanvasTexture(cv);
  }

  useFrame(() => {
    const core = coreRef.current;
    const glow = glowRef.current;
    const trail = trailRef.current;
    if (!core || !glow || !trail) return;

    if (!pulseData.running || pulseData.visitOrder.length === 0) {
      core.visible = false;
      glow.visible = false;
      trail.visible = false;
      return;
    }

    core.visible = true;
    glow.visible = true;
    trail.visible = true;

    const { visitOrder, positions } = pulseData;
    const step = stepRef.current;

    if (step >= visitOrder.length - 1) {
      pulseData.running = false;
      core.visible = false;
      glow.visible = false;
      // 탐색 완료 — 하이라이트 3초간 유지 후 해제
      const finalLit = [...litRef.current];
      setTimeout(() => {
        // 아직 같은 하이라이트 상태이면 해제
        const current = useGraphStore.getState().highlightedNodeIds;
        if (finalLit.length > 0 && finalLit.every(id => current.has(id))) {
          useGraphStore.getState().setHighlightedNodes([]);
        }
        useGraphStore.getState().setPulseParticlePos(null);
        stepRef.current = 0;
        tRef.current = 0;
        litRef.current = [];
        trailCount.current = 0;
        if (trail) trail.visible = false;
      }, 3000);
      return;
    }

    const from = positions.get(visitOrder[step]) ?? [0, 0, 0];
    const to = positions.get(visitOrder[step + 1]) ?? [0, 0, 0];

    // 부드러운 이동
    tRef.current += 0.03;
    const t = tRef.current;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    const x = from[0] + (to[0] - from[0]) * ease;
    const y = from[1] + (to[1] - from[1]) * ease;
    const z = from[2] + (to[2] - from[2]) * ease;

    // 코어 입자 위치
    const corePos = core.geometry.getAttribute('position') as THREE.BufferAttribute;
    corePos.setXYZ(0, x, y, z);
    corePos.needsUpdate = true;

    const glowPos = glow.geometry.getAttribute('position') as THREE.BufferAttribute;
    glowPos.setXYZ(0, x, y, z);
    glowPos.needsUpdate = true;

    // 궤적 기록
    const tb = trailBuf.current;
    const hi = trailHead.current % TRAIL_LENGTH;
    tb[hi * 3] = x;
    tb[hi * 3 + 1] = y;
    tb[hi * 3 + 2] = z;
    trailHead.current++;
    trailCount.current = Math.min(trailCount.current + 1, TRAIL_LENGTH);

    // 궤적 라인 업데이트
    const trailPos = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = trailCount.current;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      if (i < count) {
        const idx = ((trailHead.current - count + i) % TRAIL_LENGTH + TRAIL_LENGTH) % TRAIL_LENGTH;
        trailPos.setXYZ(i, tb[idx * 3], tb[idx * 3 + 1], tb[idx * 3 + 2]);
      } else {
        trailPos.setXYZ(i, x, y, z); // 아직 안 채워진 부분은 현재 위치
      }
    }
    trailPos.needsUpdate = true;
    trail.geometry.setDrawRange(0, count);

    // 플래시 감쇠
    flashRef.current *= 0.88;

    // Light mode: 진한 색 + NormalBlending / Dark mode: 밝은 색 + AdditiveBlending
    const currentIsLight = useGraphStore.getState().theme === 'light';

    // 코어
    const coreMat = core.material as THREE.PointsMaterial;
    coreMat.size = (currentIsLight ? 12 : 8) + flashRef.current * 6;
    coreMat.color.set(currentIsLight ? '#1144cc' : '#ffffff');
    coreMat.blending = currentIsLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    coreMat.opacity = currentIsLight ? 1.0 : 0.95;

    // 글로우
    const glowMat = glow.material as THREE.PointsMaterial;
    glowMat.size = (currentIsLight ? 28 : 20) + flashRef.current * 15;
    glowMat.opacity = currentIsLight ? (0.3 + flashRef.current * 0.3) : (0.25 + flashRef.current * 0.2);
    glowMat.color.set(currentIsLight ? '#2266dd' : '#66ddff');
    glowMat.blending = currentIsLight ? THREE.NormalBlending : THREE.AdditiveBlending;

    // 궤적
    const trailMat = trail.material as THREE.LineBasicMaterial;
    trailMat.color.set(currentIsLight ? '#2255bb' : '#44bbff');
    trailMat.opacity = currentIsLight ? 0.5 : 0.25;
    trailMat.blending = currentIsLight ? THREE.NormalBlending : THREE.AdditiveBlending;

    // 노드 도착
    if (t >= 1) {
      tRef.current = 0;
      stepRef.current++;

      const arrivedId = visitOrder[Math.min(step + 1, visitOrder.length - 1)];
      if (!litRef.current.includes(arrivedId)) {
        litRef.current.push(arrivedId);
        useGraphStore.getState().setHighlightedNodes([...litRef.current]);
      }
      flashRef.current = 1;

      // 도착 노드 툴팁 표시 (0.8초 후 자동 해제)
      useGraphStore.getState().hoverNode(arrivedId);
      setTimeout(() => {
        // 아직 같은 노드를 표시 중이면 해제
        if (useGraphStore.getState().hoveredNodeId === arrivedId) {
          useGraphStore.getState().hoverNode(null);
        }
      }, 800);
    }
  });

  return (
    <group>
      {/* 궤적 라인 — 시안 글로우 */}
      <primitive
        ref={trailRef}
        object={(() => {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TRAIL_LENGTH * 3), 3));
          const mat = new THREE.LineBasicMaterial({
            color: '#44bbff', transparent: true, opacity: 0.25,
            depthWrite: false, blending: THREE.AdditiveBlending,
          });
          return new THREE.Line(geo, mat);
        })()}
        visible={false}
      />

      {/* 글로우 (부드러운 빛 번짐) */}
      <points ref={glowRef} visible={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(3), 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#66ddff"
          size={20}
          transparent
          opacity={0.25}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
          map={texture.current}
        />
      </points>

      {/* 코어 (밝은 화이트 점) */}
      <points ref={coreRef} visible={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(3), 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#ffffff"
          size={8}
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
          map={texture.current}
        />
      </points>
    </group>
  );
}
