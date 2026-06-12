// Embedded 3D knowledge graph panel for the desktop app.
// W1-8 full repair (plan §3 W1-8 items 1-8):
//   1. Maps core IPC shape {label, clusterId, no position} → renderer shape (deterministic hash(id) layout)
//   2. InstancedMesh spheres (per-node size actually renders; chosen over PointsMaterial shader patching — robust)
//   3. Hover never reallocates buffers (imperative instance-matrix scale, hover kept out of memo deps)
//   4. Edges: accent color, opacity 0.35
//   5. Auto-rotate only after 5s idle, with ease-in
//   6. HTML overlay hover label (no drei <Text>/troika — avoids worker + CDN font CSP issues)
//   7. Scene wrapped in an ErrorBoundary
//   8. [Global|Local] toggle + BFS depth slider (1-3) from the active note + zoom-to-fit

import { Component, useEffect, useState, useRef, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { ipc } from '../../lib/ipc-client.js';
import { useAppStore } from '../../stores/app-store.js';

// Shape actually sent by core.buildGraphData over IPC (§4-F: position is NEVER sent).
interface CoreGraphNode {
  id: string;
  label?: string;
  title?: string;        // tolerated legacy shape
  filePath: string;
  clusterId?: number;
  cluster?: number;      // tolerated legacy shape
  size?: number;
}

interface GraphNode {
  id: string;
  title: string;
  filePath: string;
  cluster: number;
  size: number;
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

// Global mode safety cap (8k+ vault risk in plan §3 W1-8): keep top-N by size (degree proxy).
const MAX_GLOBAL_NODES = 3000;

// ─── Deterministic layout: hash(id)-seeded positions (stable across reopens) ───

function hash32(str: string): number {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sphericalPoint(rng: () => number, radius: number): [number, number, number] {
  const theta = rng() * Math.PI * 2;
  const phi = Math.acos(2 * rng() - 1);
  const r = Math.cbrt(rng()) * radius;
  return [
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.sin(phi) * Math.sin(theta),
    r * Math.cos(phi),
  ];
}

function seededPosition(id: string, cluster: number): [number, number, number] {
  // Cluster center on a deterministic shell, node jittered around it → visible grouping.
  const c = sphericalPoint(mulberry32(hash32(`cluster:${cluster}`)), 1);
  const center: [number, number, number] = [c[0] * 70, c[1] * 70, c[2] * 70];
  const offset = sphericalPoint(mulberry32(hash32(id)), 45);
  return [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]];
}

function mapCoreNodes(raw: CoreGraphNode[]): GraphNode[] {
  return raw.map((n) => {
    const cluster = n.clusterId ?? n.cluster ?? 0;
    return {
      id: n.id,
      title: n.label ?? n.title ?? 'Untitled',
      filePath: n.filePath ?? '',
      cluster,
      size: Math.min(8, Math.max(1, n.size ?? 2)),
      position: seededPosition(n.id, cluster),
    };
  });
}

function readAccentColor(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return v || '#6366f1';
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

// ─── Error boundary (item 7) ─────────────────────────

class GraphErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[graph] render error:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
          Graph failed to render: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Scene ───────────────────────────────────────────

interface HoverInfo {
  index: number;
  clientX: number;
  clientY: number;
}

function ZoomToFit({ signal, nodes, controlsRef }: {
  signal: number;
  nodes: GraphNode[];
  controlsRef: React.MutableRefObject<any>;
}) {
  const { camera } = useThree();
  useEffect(() => {
    if (nodes.length === 0) return;
    const box = new THREE.Box3();
    for (const n of nodes) box.expandByPoint(new THREE.Vector3(...n.position));
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(20, box.getSize(new THREE.Vector3()).length() / 2);
    const fov = ((camera as THREE.PerspectiveCamera).fov ?? 55) * (Math.PI / 180);
    const dist = (radius / Math.tan(fov / 2)) * 1.2;
    camera.position.set(center.x, center.y + radius * 0.3, center.z + dist);
    camera.lookAt(center);
    if (controlsRef.current) {
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
    // Intentionally re-fit only when signal changes (not on incidental node updates).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);
  return null;
}

function GraphScene({ nodes, edges, accent, fitSignal, onNodeClick, onHover }: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  accent: string;
  fitSignal: number;
  onNodeClick: (node: GraphNode) => void;
  onHover: (info: HoverInfo | null) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const controlsRef = useRef<any>(null);
  const hoveredRef = useRef<number | null>(null);
  const lastInteractRef = useRef<number>(Date.now());
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const baseScale = useCallback((n: GraphNode) => 0.9 + n.size * 0.45, []);

  const writeInstance = useCallback((index: number, scaleMult: number) => {
    const mesh = meshRef.current;
    const node = nodes[index];
    if (!mesh || !node) return;
    dummy.position.set(node.position[0], node.position[1], node.position[2]);
    dummy.scale.setScalar(baseScale(node) * scaleMult);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }, [nodes, dummy, baseScale]);

  // Populate instance matrices + colors whenever the node set changes.
  // Hover is intentionally NOT a dependency (item 3: no buffer realloc on hover).
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    hoveredRef.current = null;
    const color = new THREE.Color();
    for (let i = 0; i < nodes.length; i++) {
      dummy.position.set(nodes[i].position[0], nodes[i].position[1], nodes[i].position[2]);
      dummy.scale.setScalar(baseScale(nodes[i]));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.set(CLUSTER_COLORS[nodes[i].cluster % CLUSTER_COLORS.length]);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [nodes, dummy, baseScale]);

  const setHovered = useCallback((index: number | null) => {
    if (hoveredRef.current === index) return;
    if (hoveredRef.current != null) writeInstance(hoveredRef.current, 1);
    if (index != null) writeInstance(index, 1.7);
    hoveredRef.current = index;
  }, [writeInstance]);

  // Edge line geometry — depends only on the node/edge sets.
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

  // Idle-only auto-rotate (item 5): start after 5s of no interaction, ease in over 3s.
  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls || hoveredRef.current != null) return;
    const idleMs = Date.now() - lastInteractRef.current;
    if (idleMs < 5000) return;
    const ramp = Math.min(1, (idleMs - 5000) / 3000);
    controls.setAzimuthalAngle(controls.getAzimuthalAngle() + 0.0012 * ramp);
    controls.update();
  });

  const markInteraction = useCallback(() => { lastInteractRef.current = Date.now(); }, []);

  return (
    <>
      <ambientLight intensity={0.7} />
      <pointLight position={[200, 150, 200]} intensity={0.7} color="#aabbff" />

      <ZoomToFit signal={fitSignal} nodes={nodes} controlsRef={controlsRef} />

      {/* Edges (item 4: accent color, opacity 0.35) */}
      {edgePositions.length > 0 && (
        <lineSegments key={`edges-${edgePositions.length}`}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[edgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={accent} transparent opacity={0.35} />
        </lineSegments>
      )}

      {/* Nodes — InstancedMesh spheres (item 2): per-node size works, always circular */}
      {nodes.length > 0 && (
        <instancedMesh
          key={`nodes-${nodes.length}`}
          ref={meshRef}
          args={[undefined, undefined, nodes.length]}
          onPointerMove={(e) => {
            e.stopPropagation();
            markInteraction();
            if (e.instanceId != null) {
              setHovered(e.instanceId);
              onHover({ index: e.instanceId, clientX: e.clientX, clientY: e.clientY });
            }
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            setHovered(null);
            onHover(null);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (e.instanceId != null && nodes[e.instanceId]) onNodeClick(nodes[e.instanceId]);
          }}
        >
          <sphereGeometry args={[1, 12, 12]} />
          <meshLambertMaterial transparent opacity={0.95} />
        </instancedMesh>
      )}

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
        minDistance={10}
        maxDistance={1500}
        rotateSpeed={0.5}
        onStart={markInteraction}
      />
    </>
  );
}

// ─── BFS for local graph (item 8) ────────────────────

function bfsFilter(nodes: GraphNode[], edges: GraphEdge[], startId: string, depth: number): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    if (!adjacency.has(e.target)) adjacency.set(e.target, []);
    adjacency.get(e.source)!.push(e.target);
    adjacency.get(e.target)!.push(e.source);
  }
  const visited = new Set<string>([startId]);
  let frontier = [startId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const peer of adjacency.get(id) ?? []) {
        if (!visited.has(peer)) {
          visited.add(peer);
          next.push(peer);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return {
    nodes: nodes.filter((n) => visited.has(n.id)),
    edges: edges.filter((e) => visited.has(e.source) && visited.has(e.target)),
  };
}

// ─── Panel ───────────────────────────────────────────

export function GraphPanel() {
  const [allNodes, setAllNodes] = useState<GraphNode[]>([]);
  const [allEdges, setAllEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'global' | 'local'>('global');
  const [depth, setDepth] = useState(1);
  const [fitSignal, setFitSignal] = useState(0);
  const [hover, setHover] = useState<{ title: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const coreReady = useAppStore((s) => s.coreReady);
  const openFile = useAppStore((s) => s.openFile);
  const vaultPath = useAppStore((s) => s.vaultPath);
  const activeFilePath = useAppStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.filePath ?? null;
  });

  const accent = useMemo(() => readAccentColor(), []);

  useEffect(() => {
    if (!coreReady) return;
    void (async () => {
      setLoading(true);
      try {
        const data = await ipc('graph:build', 'semantic') as unknown as {
          nodes: CoreGraphNode[];
          edges: GraphEdge[];
        };
        setAllNodes(mapCoreNodes(data.nodes ?? []));
        setAllEdges((data.edges ?? []) as GraphEdge[]);
      } catch (err) {
        console.error('[graph] build failed:', err);
        setAllNodes([]);
        setAllEdges([]);
      }
      setLoading(false);
    })();
  }, [coreReady]);

  // Active note → graph node (core stores vault-relative paths; tabs hold absolute paths).
  const activeNode = useMemo(() => {
    if (!activeFilePath) return null;
    const abs = normalizePath(activeFilePath);
    return allNodes.find((n) => {
      if (!n.filePath) return false;
      const rel = normalizePath(n.filePath);
      return abs === rel || abs.endsWith('/' + rel);
    }) ?? null;
  }, [allNodes, activeFilePath]);

  // Visible subset: local BFS or capped global.
  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (mode === 'local' && activeNode) {
      const filtered = bfsFilter(allNodes, allEdges, activeNode.id, depth);
      return { visibleNodes: filtered.nodes, visibleEdges: filtered.edges };
    }
    if (allNodes.length > MAX_GLOBAL_NODES) {
      const kept = [...allNodes].sort((a, b) => b.size - a.size).slice(0, MAX_GLOBAL_NODES);
      const keptIds = new Set(kept.map((n) => n.id));
      return {
        visibleNodes: kept,
        visibleEdges: allEdges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target)),
      };
    }
    return { visibleNodes: allNodes, visibleEdges: allEdges };
  }, [mode, depth, activeNode, allNodes, allEdges]);

  // Re-fit when the visible scope changes meaningfully.
  useEffect(() => {
    if (mode === 'local') setFitSignal((s) => s + 1);
  }, [mode, depth, activeNode]);

  const handleNodeClick = useCallback(async (node: GraphNode) => {
    if (!node.filePath) return;
    try {
      const isAbsolute = /^([a-zA-Z]:[\\/]|\/)/.test(node.filePath);
      const fullPath = isAbsolute ? node.filePath : `${vaultPath}/${node.filePath}`;
      const content = await ipc('vault:read-file', fullPath);
      openFile(fullPath, node.title, content);
    } catch { /* skip unreadable */ }
  }, [openFile, vaultPath]);

  const handleHover = useCallback((info: HoverInfo | null) => {
    if (!info) { setHover(null); return; }
    const node = visibleNodes[info.index];
    if (!node) { setHover(null); return; }
    const rect = containerRef.current?.getBoundingClientRect();
    setHover({
      title: node.title,
      x: info.clientX - (rect?.left ?? 0),
      y: info.clientY - (rect?.top ?? 0),
    });
  }, [visibleNodes]);

  if (!coreReady || loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
        {coreReady ? 'Building graph...' : 'Waiting for AI engine...'}
      </div>
    );
  }

  if (allNodes.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
        No documents indexed. Run re-index from the AI panel.
      </div>
    );
  }

  const toggleButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    fontSize: 11,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    background: active ? 'var(--accent)' : 'rgba(120,120,160,0.15)',
    color: active ? '#fff' : 'var(--ink-dim)',
  });

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <GraphErrorBoundary>
        <Canvas
          camera={{ position: [0, 50, 200], fov: 55 }}
          style={{ background: '#050510' }}
          gl={{ antialias: true }}
        >
          <GraphScene
            nodes={visibleNodes}
            edges={visibleEdges}
            accent={accent}
            fitSignal={fitSignal}
            onNodeClick={handleNodeClick}
            onHover={handleHover}
          />
        </Canvas>
      </GraphErrorBoundary>

      {/* Controls overlay: [Global|Local] + depth slider + zoom-to-fit (item 8) */}
      <div style={{
        position: 'absolute',
        top: 8,
        left: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 6px',
        borderRadius: 6,
        background: 'rgba(10,10,20,0.7)',
      }}>
        <button style={toggleButtonStyle(mode === 'global')} onClick={() => setMode('global')}>
          Global
        </button>
        <button style={toggleButtonStyle(mode === 'local')} onClick={() => setMode('local')}>
          Local
        </button>
        {mode === 'local' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--ink-dim)' }}>
            Depth
            <input
              type="range"
              min={1}
              max={3}
              step={1}
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              style={{ width: 56 }}
            />
            {depth}
          </label>
        )}
        <button
          style={toggleButtonStyle(false)}
          title="Zoom to fit"
          onClick={() => setFitSignal((s) => s + 1)}
        >
          Fit
        </button>
      </div>

      {/* Local mode without an active (indexed) note */}
      {mode === 'local' && !activeNode && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          textAlign: 'center',
          color: 'var(--ink-faint)',
          fontSize: 12,
          pointerEvents: 'none',
        }}>
          Open an indexed note to see its local graph.
        </div>
      )}

      {/* Hover label — HTML overlay, no troika/CDN fonts (item 6) */}
      {hover && (
        <div style={{
          position: 'absolute',
          left: hover.x + 12,
          top: hover.y + 12,
          maxWidth: 240,
          padding: '3px 8px',
          fontSize: 11,
          color: '#e0e0f0',
          background: 'rgba(15,15,30,0.9)',
          border: '1px solid rgba(120,120,200,0.3)',
          borderRadius: 4,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {hover.title}
        </div>
      )}

      <div style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        fontSize: 10,
        color: 'rgba(200,200,255,0.4)',
      }}>
        {visibleNodes.length} nodes · {visibleEdges.length} edges
        {mode === 'global' && allNodes.length > MAX_GLOBAL_NODES && ` (top ${MAX_GLOBAL_NODES} of ${allNodes.length})`}
      </div>
    </div>
  );
}
