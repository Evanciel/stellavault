// Embedded 3D knowledge graph panel for the desktop app.
// Lightweight version using React Three Fiber + IPC data.

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { ipc } from '../../lib/ipc-client.js';
import { useAppStore } from '../../stores/app-store.js';

interface GraphNode {
  id: string;
  title: string;
  filePath: string;
  cluster: number;
  position: [number, number, number];
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

const CLUSTER_COLORS = [
  '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6',
  '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16', '#f97316',
];

function GraphScene({ nodes, edges, onNodeClick }: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick: (node: GraphNode) => void;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  // Build position + color arrays
  const { positions, colors, sizes } = useMemo(() => {
    const pos = new Float32Array(nodes.length * 3);
    const col = new Float32Array(nodes.length * 3);
    const sz = new Float32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      pos[i * 3] = nodes[i].position[0];
      pos[i * 3 + 1] = nodes[i].position[1];
      pos[i * 3 + 2] = nodes[i].position[2];
      const c = new THREE.Color(CLUSTER_COLORS[nodes[i].cluster % CLUSTER_COLORS.length]);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      sz[i] = hovered === i ? 12 : 6;
    }
    return { positions: pos, colors: col, sizes: sz };
  }, [nodes, hovered]);

  // Edge lines
  const edgePositions = useMemo(() => {
    const nodeMap = new Map(nodes.map((n, i) => [n.id, i]));
    const pts: number[] = [];
    for (const e of edges) {
      const si = nodeMap.get(e.source);
      const ti = nodeMap.get(e.target);
      if (si == null || ti == null) continue;
      pts.push(
        nodes[si].position[0], nodes[si].position[1], nodes[si].position[2],
        nodes[ti].position[0], nodes[ti].position[1], nodes[ti].position[2],
      );
    }
    return new Float32Array(pts);
  }, [nodes, edges]);

  const controlsRef = useRef<any>(null);

  useFrame(() => {
    if (controlsRef.current && hovered == null) {
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + 0.001);
      controlsRef.current.update();
    }
  });

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[200, 150, 200]} intensity={0.6} color="#6688ff" />

      {/* Edges */}
      {edgePositions.length > 0 && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[edgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#6366f1" transparent opacity={0.12} />
        </lineSegments>
      )}

      {/* Nodes */}
      <points
        ref={pointsRef}
        onPointerOver={(e) => { e.stopPropagation(); if (e.index != null) setHovered(e.index); }}
        onPointerOut={() => setHovered(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (e.index != null && nodes[e.index]) onNodeClick(nodes[e.index]);
        }}
      >
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
          <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          transparent
          opacity={0.9}
          sizeAttenuation
          size={6}
          depthWrite={false}
        />
      </points>

      {/* Hover label */}
      {hovered != null && nodes[hovered] && (
        <Billboard position={nodes[hovered].position}>
          <Text fontSize={3} color="#e0e0f0" anchorX="center" anchorY="bottom" font={undefined}>
            {nodes[hovered].title}
          </Text>
        </Billboard>
      )}

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
        minDistance={30}
        maxDistance={500}
        rotateSpeed={0.5}
      />
    </>
  );
}

export function GraphPanel() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const coreReady = useAppStore((s) => s.coreReady);
  const openFile = useAppStore((s) => s.openFile);

  useEffect(() => {
    if (!coreReady) return;
    void (async () => {
      setLoading(true);
      const data = await ipc('graph:build', 'semantic');
      setNodes((data.nodes ?? []) as GraphNode[]);
      setEdges((data.edges ?? []) as GraphEdge[]);
      setLoading(false);
    })();
  }, [coreReady]);

  const handleNodeClick = useCallback(async (node: GraphNode) => {
    if (!node.filePath) return;
    try {
      const content = await ipc('vault:read-file', node.filePath);
      openFile(node.filePath, node.title, content);
    } catch { /* skip */ }
  }, [openFile]);

  if (!coreReady || loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
        {coreReady ? 'Building graph...' : 'Waiting for AI engine...'}
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
        No documents indexed. Run re-index from the AI panel.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 50, 200], fov: 55 }}
        raycaster={{ params: { Points: { threshold: 10 } } } as any}
        style={{ background: '#050510' }}
        gl={{ antialias: true }}
      >
        <GraphScene nodes={nodes} edges={edges} onNodeClick={handleNodeClick} />
      </Canvas>

      <div style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        fontSize: 10,
        color: 'rgba(200,200,255,0.4)',
      }}>
        {nodes.length} nodes · {edges.length} edges
      </div>
    </div>
  );
}
