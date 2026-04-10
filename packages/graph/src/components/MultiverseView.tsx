// Design Ref: Phase 1c — 멀티버스 뷰
// "내 우주"가 대형 구체, 피어 우주들이 주변에 연결

import { useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { useGraphStore } from '../stores/graph-store.js';

const UNIVERSE_COLORS = [
  '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6',
  '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16', '#f97316',
];

interface UniverseData {
  id: string;
  name: string;
  documentCount: number;
  topTopics: string[];
  position: [number, number, number];
  color: string;
  isMe: boolean;
}

function UniverseNode({ data, onClick }: { data: UniverseData; onClick: () => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';

  // 크기: 문서 수 기반 (최소 2, 최대 8)
  const size = Math.max(2, Math.min(8, Math.sqrt(data.documentCount / 50) * 2));
  const myScale = data.isMe ? 1.5 : 1;

  useFrame((state) => {
    if (meshRef.current) {
      // 부드러운 회전
      meshRef.current.rotation.y += data.isMe ? 0.003 : 0.001;
    }
    if (glowRef.current) {
      // 호흡 효과
      const pulse = 1 + Math.sin(state.clock.elapsedTime * (data.isMe ? 1.5 : 0.8)) * 0.1;
      glowRef.current.scale.setScalar(pulse);
    }
  });

  const color = new THREE.Color(data.color);

  return (
    <group position={data.position} onClick={onClick} onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = 'default'; }}>
      {/* 글로우 */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[size * myScale * 1.4, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isDark ? 0.08 : 0.04}
          depthWrite={false}
        />
      </mesh>

      {/* 코어 구체 */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[size * myScale, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={data.isMe ? 0.4 : 0.15}
          roughness={0.3}
          metalness={0.7}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* 라벨 */}
      <Billboard position={[0, size * myScale + 2, 0]}>
        <Text
          fontSize={data.isMe ? 1.8 : 1.2}
          color={isDark ? '#c0c0f0' : '#2a2a4a'}
          anchorX="center"
          anchorY="bottom"
          font={undefined}
        >
          {data.isMe ? 'My Universe' : data.name}
        </Text>
        <Text
          fontSize={0.8}
          color={isDark ? '#556' : '#999'}
          anchorX="center"
          anchorY="top"
          position={[0, -0.3, 0]}
          font={undefined}
        >
          {`${data.documentCount} docs`}
        </Text>
      </Billboard>

      {/* 토픽 태그 (내 우주만) */}
      {data.isMe && data.topTopics.length > 0 && (
        <Billboard position={[0, -(size * myScale + 1.5), 0]}>
          <Text
            fontSize={0.6}
            color={isDark ? '#445' : '#bbb'}
            anchorX="center"
            font={undefined}
          >
            {data.topTopics.slice(0, 3).map(t => `#${t}`).join('  ')}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

function MultiverseEdges({ universes }: { universes: UniverseData[] }) {
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';
  const myUniverse = universes.find(u => u.isMe);
  if (!myUniverse) return null;

  const positions = useMemo(() => {
    const pts: number[] = [];
    for (const u of universes) {
      if (u.isMe) continue;
      pts.push(...myUniverse.position, ...u.position);
    }
    return new Float32Array(pts);
  }, [universes, myUniverse]);

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={isDark ? '#6366f1' : '#3b82f6'}
        transparent
        opacity={0.2}
        linewidth={1}
      />
    </lineSegments>
  );
}

function MultiverseScene() {
  const nodes = useGraphStore((s) => s.nodes);
  const peers = useGraphStore((s) => s.federationPeers);
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';

  // 우주 데이터 구성
  const universes = useMemo<UniverseData[]>(() => {
    const result: UniverseData[] = [];

    // 내 우주 (중앙)
    result.push({
      id: 'me',
      name: 'My Universe',
      documentCount: nodes.length,
      topTopics: [],
      position: [0, 0, 0],
      color: '#6366f1',
      isMe: true,
    });

    // 피어 우주들 (원형 배치)
    for (let i = 0; i < peers.length; i++) {
      const angle = (i / Math.max(peers.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = 30 + peers.length * 5;
      result.push({
        id: peers[i].peerId,
        name: peers[i].displayName,
        documentCount: peers[i].documentCount,
        topTopics: peers[i].topTopics,
        position: [
          radius * Math.cos(angle),
          (Math.random() - 0.5) * 10,
          radius * Math.sin(angle),
        ],
        color: UNIVERSE_COLORS[i % UNIVERSE_COLORS.length],
        isMe: false,
      });
    }

    return result;
  }, [nodes.length, peers]);

  const handleUniverseClick = useCallback((u: UniverseData) => {
    if (u.isMe) {
      setViewMode('universe');
    }
  }, [setViewMode]);

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 50, 50]} intensity={0.8} />

      {universes.map((u) => (
        <UniverseNode key={u.id} data={u} onClick={() => handleUniverseClick(u)} />
      ))}

      <MultiverseEdges universes={universes} />

      <OrbitControls
        enablePan
        enableZoom
        minDistance={20}
        maxDistance={200}
        autoRotate
        autoRotateSpeed={0.3}
      />

      {/* 배경 파티클 */}
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array(Array.from({ length: 300 }, () => (Math.random() - 0.5) * 300)), 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.3}
          color={isDark ? '#334' : '#ddd'}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </points>
    </>
  );
}

export function MultiverseView() {
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const peers = useGraphStore((s) => s.federationPeers);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas camera={{ position: [0, 30, 80], fov: 50 }}>
        <color attach="background" args={[isDark ? '#020208' : '#f0f2f8']} />
        <fog attach="fog" args={[isDark ? '#020208' : '#f0f2f8', 100, 250]} />
        <MultiverseScene />
      </Canvas>

      {/* 오버레이 UI */}
      <div style={{
        position: 'absolute', top: '16px', left: '16px',
        color: isDark ? '#c0c0f0' : '#2a2a4a',
        fontSize: '12px',
      }}>
        <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>
          Stella Network
        </div>
        <div style={{ color: isDark ? '#556' : '#999' }}>
          {peers.length > 0
            ? `${peers.length} peer${peers.length !== 1 ? 's' : ''} connected`
            : 'Solo mode — no peers connected'}
        </div>
      </div>

      {peers.length === 0 && (
        <div style={{
          position: 'absolute', bottom: '60px', left: '50%', transform: 'translateX(-50%)',
          color: isDark ? '#667' : '#999', fontSize: '12px', textAlign: 'center',
          background: isDark ? 'rgba(10,10,30,0.85)' : 'rgba(255,255,255,0.95)',
          padding: '14px 20px', borderRadius: '10px',
          border: `1px solid ${isDark ? 'rgba(100,120,255,0.2)' : 'rgba(0,0,0,0.1)'}`,
          maxWidth: '380px',
        }}>
          <div style={{ marginBottom: '10px', color: isDark ? '#aab' : '#555', fontSize: '13px' }}>
            Your universe floats alone — for now.
          </div>
          <button
            onClick={async () => {
              try {
                const resp = await fetch('/api/federate/join', { method: 'POST' });
                const data = await resp.json();
                if (data.success) {
                  alert('Connected to Stella Network! Peers will appear as they join.');
                } else {
                  alert('Federation not yet available in this build. Run: stellavault federate join');
                }
              } catch {
                alert('Federation API not available. Run in terminal: stellavault federate join');
              }
            }}
            style={{
              padding: '8px 20px', fontSize: '12px',
              background: isDark ? '#6366f1' : '#e0e7ff',
              border: 'none', borderRadius: '6px',
              color: isDark ? '#fff' : '#6366f1',
              cursor: 'pointer', fontWeight: 600, marginBottom: '8px',
            }}
          >
            Connect to Stella Network
          </button>
          <div style={{ fontSize: '10px', color: isDark ? '#556' : '#aaa' }}>
            Only embeddings shared — never original text.
          </div>
        </div>
      )}

      <div style={{
        position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
        color: isDark ? '#556' : '#999', fontSize: '11px',
      }}>
        Click "My Universe" to enter your knowledge graph
      </div>

      <button
        onClick={() => setViewMode('universe')}
        style={{
          position: 'absolute', top: '16px', right: '16px',
          padding: '6px 14px', fontSize: '11px',
          background: isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.04)',
          border: `1px solid ${isDark ? 'rgba(100,120,255,0.2)' : 'rgba(0,0,0,0.1)'}`,
          borderRadius: '6px', cursor: 'pointer',
          color: isDark ? '#88aaff' : '#4466aa',
        }}
      >
        Enter My Universe
      </button>
    </div>
  );
}
