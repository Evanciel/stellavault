// Embeddable 3D mini-graph widget (F-A08)
// Lightweight version for iframe embedding

import { useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

interface EmbedNode {
  id: string;
  label: string;
  clusterId: number;
  position: [number, number, number];
  size: number;
}

interface EmbedEdge {
  source: string;
  target: string;
  weight: number;
}

interface EmbedData {
  nodes: EmbedNode[];
  edges: EmbedEdge[];
  title?: string;
}

const PALETTE = [
  [0.49, 0.23, 0.93], [0.93, 0.27, 0.60], [0.96, 0.62, 0.04],
  [0.06, 0.72, 0.51], [0.23, 0.51, 0.96], [0.94, 0.27, 0.27],
  [0.02, 0.71, 0.83], [0.52, 0.80, 0.09], [0.98, 0.57, 0.09],
  [0.55, 0.36, 0.96],
] as number[][];

function EmbedNodes({ nodes }: { nodes: EmbedNode[] }) {
  const ref = useRef<THREE.Points>(null);

  const { positions, colors, sizes } = useMemo(() => {
    const n = nodes.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const sz = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      pos[i * 3] = node.position[0];
      pos[i * 3 + 1] = node.position[1];
      pos[i * 3 + 2] = node.position[2];

      const pal = PALETTE[node.clusterId % PALETTE.length];
      col[i * 3] = pal[0];
      col[i * 3 + 1] = pal[1];
      col[i * 3 + 2] = pal[2];

      sz[i] = 3 + node.size * 3;
    }
    return { positions: pos, colors: col, sizes: sz };
  }, [nodes]);

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial vertexColors transparent opacity={0.9} depthWrite={false} sizeAttenuation size={6} />
    </points>
  );
}

function EmbedEdges({ nodes, edges }: { nodes: EmbedNode[]; edges: EmbedEdge[] }) {
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const positions = useMemo(() => {
    const pos: number[] = [];
    for (const e of edges) {
      const s = nodeMap.get(e.source);
      const t = nodeMap.get(e.target);
      if (s && t) {
        pos.push(...s.position, ...t.position);
      }
    }
    return new Float32Array(pos);
  }, [edges, nodeMap]);

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#6366f1" transparent opacity={0.15} />
    </lineSegments>
  );
}

function AutoRotate() {
  useFrame(({ camera }) => {
    camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.002);
  });
  return null;
}

function Scene({ data, interactive }: { data: EmbedData; interactive: boolean }) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <EmbedNodes nodes={data.nodes} />
      <EmbedEdges nodes={data.nodes} edges={data.edges} />
      {interactive ? (
        <OrbitControls enablePan={false} enableZoom={true} autoRotate autoRotateSpeed={0.5} />
      ) : (
        <AutoRotate />
      )}
    </>
  );
}

export function EmbedGraph({ data, interactive = true, theme = 'dark' }: {
  data: EmbedData;
  interactive?: boolean;
  theme?: 'dark' | 'light';
}) {
  const bg = theme === 'dark' ? '#050510' : '#f0f2f8';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: bg }}>
      <Canvas camera={{ position: [0, 0, 500], fov: 50 }}>
        <color attach="background" args={[bg]} />
        <Scene data={data} interactive={interactive} />
      </Canvas>
      {data.title && (
        <div style={{
          position: 'absolute', bottom: '8px', left: '8px',
          fontSize: '10px', color: theme === 'dark' ? '#556' : '#999',
          fontFamily: 'system-ui, sans-serif',
        }}>
          {data.title} — stellavault
        </div>
      )}
    </div>
  );
}
