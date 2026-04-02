// 우주 배경: 다층 별 + 성운 효과 + 은하수

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGraphStore } from '../stores/graph-store.js';

// 원형 별 텍스처
function createStarTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.15, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(0.4, 'rgba(200,220,255,0.2)');
  gradient.addColorStop(1, 'rgba(200,220,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// 성운 텍스처 (부드러운 구름)
function createNebulaTexture(r: number, g: number, b: number): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(${r},${g},${b},0.7)`);
  gradient.addColorStop(0.3, `rgba(${r},${g},${b},0.35)`);
  gradient.addColorStop(0.6, `rgba(${r},${g},${b},0.12)`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const starTexture = createStarTexture();

// 성운 컬러 프리셋
const NEBULA_PRESETS = [
  { r: 100, g: 60, b: 200 },   // 보라
  { r: 30, g: 80, b: 220 },    // 딥블루
  { r: 180, g: 50, b: 120 },   // 핑크
  { r: 40, g: 120, b: 200 },   // 시안
  { r: 130, g: 40, b: 180 },   // 인디고
  { r: 60, g: 100, b: 180 },   // 스틸블루
];

const nebulaTextures = NEBULA_PRESETS.map(c => createNebulaTexture(c.r, c.g, c.b));

// --- 별 레이어 ---
function Stars({ count, minR, maxR, size, opacity, speed }: {
  count: number; minR: number; maxR: number; size: number; opacity: number; speed: number;
}) {
  const ref = useRef<THREE.Points>(null);

  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = minR + Math.random() * (maxR - minR);
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * 2 * Math.PI;
      pos[i * 3] = r * Math.sin(theta) * Math.cos(phi);
      pos[i * 3 + 1] = r * Math.cos(theta);
      pos[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);

      // 별 색상 다양화 (화이트~블루~옐로우)
      const temp = Math.random();
      if (temp < 0.6) {
        // 화이트~블루
        col[i * 3] = 0.8 + Math.random() * 0.2;
        col[i * 3 + 1] = 0.85 + Math.random() * 0.15;
        col[i * 3 + 2] = 0.95 + Math.random() * 0.05;
      } else if (temp < 0.8) {
        // 옐로우
        col[i * 3] = 1;
        col[i * 3 + 1] = 0.9 + Math.random() * 0.1;
        col[i * 3 + 2] = 0.6 + Math.random() * 0.2;
      } else {
        // 블루
        col[i * 3] = 0.5 + Math.random() * 0.3;
        col[i * 3 + 1] = 0.6 + Math.random() * 0.3;
        col[i * 3 + 2] = 1;
      }
    }
    return { positions: pos, colors: col };
  }, [count, minR, maxR]);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * speed;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        size={size}
        map={starTexture}
      />
    </points>
  );
}

// --- 성운 레이어 ---
function Nebulae() {
  const ref = useRef<THREE.Group>(null);

  const clouds = useMemo(() => {
    const items: Array<{
      pos: [number, number, number];
      scale: number;
      texIdx: number;
      opacity: number;
    }> = [];

    // 뇌 주변 + 배경에 성운 구름 대량 배치
    for (let i = 0; i < 25; i++) {
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * 2 * Math.PI;
      const r = 300 + Math.random() * 900;
      items.push({
        pos: [
          r * Math.sin(theta) * Math.cos(phi),
          r * Math.cos(theta),
          r * Math.sin(theta) * Math.sin(phi),
        ],
        scale: 300 + Math.random() * 600,
        texIdx: Math.floor(Math.random() * nebulaTextures.length),
        opacity: 0.06 + Math.random() * 0.12,
      });
    }
    return items;
  }, []);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.002;
    }
  });

  return (
    <group ref={ref}>
      {clouds.map((cloud, i) => (
        <sprite key={i} position={cloud.pos} scale={[cloud.scale, cloud.scale, 1]}>
          <spriteMaterial
            map={nebulaTextures[cloud.texIdx]}
            transparent
            opacity={cloud.opacity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}

// --- 메인 ---
export function StarField() {
  // Light mode에서는 별/성운 숨김 — 밝은 배경에 부적합
  const theme = useGraphStore((s) => s.theme);
  if (theme === 'light') return null;

  return (
    <group>
      {/* 원경 별 (작고 많음) */}
      <Stars count={3000} minR={1200} maxR={2500} size={1.2} opacity={0.5} speed={0.003} />
      {/* 중경 별 (중간) */}
      <Stars count={800} minR={800} maxR={1400} size={2} opacity={0.6} speed={0.005} />
      {/* 근경 밝은 별 (크고 적음) */}
      <Stars count={150} minR={600} maxR={1000} size={3.5} opacity={0.8} speed={0.007} />
      {/* 성운 */}
      <Nebulae />
    </group>
  );
}
