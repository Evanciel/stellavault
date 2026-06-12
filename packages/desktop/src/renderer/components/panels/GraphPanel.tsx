// Embedded 3D knowledge graph panel for the desktop app.
// W1-8 functionality (Global|Local + BFS depth + zoom-to-fit + HTML hover label +
// ErrorBoundary + deterministic hash(id) layout + idle auto-rotate) with the
// SIGNATURE Stellavault visual language ported from @stellavault/graph
// (GraphNodes/GraphEdges/StarField/Graph3D):
//   - deep-space radial gradient background (#0d1028 → #080c1a → #040610)
//   - star field + nebula sprites
//   - nodes as TWO point layers: additive glow + bright core, radial-gradient
//     circle texture, 15-color cluster palette, brightness boost by size
//   - hover: node → white ×2.5, connected neighbors brighten, the rest fade
//   - edges: dim #4466aa lines, hovered node's edges lit in accent
// Per-vertex point size needs a tiny ShaderMaterial (PointsMaterial ignores the
// size attribute) — raycasting still works (THREE.Points raycast is material-free).

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

// 15-color palette — identical to @stellavault/graph GraphNodes.tsx
const PALETTE: number[][] = [
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
];

// Global mode safety cap (8k+ vault risk in plan §3 W1-8): keep top-N by size (degree proxy).
const MAX_GLOBAL_NODES = 3000;

// ─── Textures (ported from @stellavault/graph) ───────

function createCircleTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
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

const circleTexture = createCircleTexture();
const starTexture = createStarTexture();
const NEBULA_PRESETS = [
  { r: 100, g: 60, b: 200 },
  { r: 30, g: 80, b: 220 },
  { r: 180, g: 50, b: 120 },
  { r: 40, g: 120, b: 200 },
];
const nebulaTextures = NEBULA_PRESETS.map((c) => createNebulaTexture(c.r, c.g, c.b));

// ─── Per-vertex-size point shader ────────────────────
// PointsMaterial ignores the `size` buffer attribute; this minimal shader makes
// per-node sizes (and hover scaling) actually render. Raycast unaffected.

function makePointsMaterial(opacity: number, additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: circleTexture },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (220.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float uOpacity;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        if (tex.a < 0.01) discard;
        gl_FragColor = vec4(vColor, uOpacity) * tex;
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

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

// ─── Error boundary ──────────────────────────────────

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

// ─── Star field (ported lite version of StarField.tsx) ───

function StarFieldLite() {
  const { starGeo, nebulae } = useMemo(() => {
    const rng = mulberry32(0x5eed);
    const n = 900;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = sphericalPoint(rng, 1);
      const r = 500 + rng() * 700;
      pos[i * 3] = x * r;
      pos[i * 3 + 1] = y * r;
      pos[i * 3 + 2] = z * r;
      const tint = 0.7 + rng() * 0.3;
      col[i * 3] = tint;
      col[i * 3 + 1] = tint;
      col[i * 3 + 2] = Math.min(1, tint + 0.08);
      sz[i] = 1 + rng() * 2.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sz, 1));
    const nebs = NEBULA_PRESETS.map((_, i) => {
      const [x, y, z] = sphericalPoint(mulberry32(0x0b0b + i * 97), 1);
      return { pos: [x * 420, y * 420, z * 420] as [number, number, number], scale: 260 + i * 60, tex: nebulaTextures[i] };
    });
    return { starGeo: geo, nebulae: nebs };
  }, []);

  const starMat = useMemo(() => makePointsMaterial(0.85, true), []);

  return (
    <group>
      <points geometry={starGeo} material={starMat} raycast={() => null} />
      {nebulae.map((n, i) => (
        <sprite key={i} position={n.pos} scale={[n.scale, n.scale, 1]} raycast={() => null}>
          <spriteMaterial map={n.tex} transparent opacity={0.13} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </group>
  );
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
  const coreRef = useRef<THREE.Points>(null);
  const glowRef = useRef<THREE.Points>(null);
  const controlsRef = useRef<any>(null);
  const hoveredRef = useRef<number | null>(null);
  const lastInteractRef = useRef<number>(Date.now());
  const { raycaster } = useThree();

  // Points raycast precision — without this hover triggers meters away.
  useEffect(() => {
    const prev = raycaster.params.Points?.threshold;
    raycaster.params.Points = { threshold: 3.5 };
    return () => { raycaster.params.Points = { threshold: prev ?? 1 }; };
  }, [raycaster]);

  // Adjacency for hover neighbor highlight.
  const neighborSets = useMemo(() => {
    const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));
    const sets = new Map<number, Set<number>>();
    for (const e of edges) {
      const si = idToIndex.get(e.source);
      const ti = idToIndex.get(e.target);
      if (si == null || ti == null) continue;
      if (!sets.has(si)) sets.set(si, new Set());
      if (!sets.has(ti)) sets.set(ti, new Set());
      sets.get(si)!.add(ti);
      sets.get(ti)!.add(si);
    }
    return sets;
  }, [nodes, edges]);

  // Base buffers — signature recipe: palette by cluster + brightness boost by size.
  const base = useMemo(() => {
    const n = nodes.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const sz = new Float32Array(n);
    const gsz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      pos[i * 3] = node.position[0];
      pos[i * 3 + 1] = node.position[1];
      pos[i * 3 + 2] = node.position[2];
      const pal = PALETTE[node.cluster % PALETTE.length];
      const bright = Math.min((node.size - 1) / 6, 1) * 0.4;
      col[i * 3] = Math.min(pal[0] + bright, 1);
      col[i * 3 + 1] = Math.min(pal[1] + bright, 1);
      col[i * 3 + 2] = Math.min(pal[2] + bright, 1);
      sz[i] = 3 + node.size * 3;
      gsz[i] = 8 + node.size * 8;
    }
    return { pos, col, sz, gsz };
  }, [nodes]);

  const coreMat = useMemo(() => makePointsMaterial(0.95, false), []);
  const glowMat = useMemo(() => makePointsMaterial(0.28, true), []);

  // Imperative hover styling — no buffer realloc, restore from base arrays.
  const applyHover = useCallback((hovered: number | null) => {
    const core = coreRef.current;
    const glow = glowRef.current;
    if (!core || !glow) return;
    const cCol = core.geometry.getAttribute('color') as THREE.BufferAttribute;
    const cSz = core.geometry.getAttribute('size') as THREE.BufferAttribute;
    const gCol = glow.geometry.getAttribute('color') as THREE.BufferAttribute;
    const gSz = glow.geometry.getAttribute('size') as THREE.BufferAttribute;
    const { col, sz, gsz } = base;
    const neighbors = hovered != null ? neighborSets.get(hovered) : undefined;
    for (let i = 0; i < nodes.length; i++) {
      let r = col[i * 3], g = col[i * 3 + 1], b = col[i * 3 + 2];
      let s = sz[i], gs = gsz[i];
      if (hovered != null) {
        if (i === hovered) {
          r = 1; g = 1; b = 1;
          s *= 2.5; gs *= 2.5;
        } else if (neighbors?.has(i)) {
          r = Math.min(r * 1.6, 1); g = Math.min(g * 1.6, 1); b = Math.min(b * 1.6, 1);
          s *= 1.5; gs *= 1.8;
        } else {
          r *= 0.06; g *= 0.06; b *= 0.06;
          s *= 0.4; gs *= 0.25;
        }
      }
      cCol.setXYZ(i, r, g, b);
      cSz.setX(i, s);
      gCol.setXYZ(i, r, g, b);
      gSz.setX(i, gs);
    }
    cCol.needsUpdate = true;
    cSz.needsUpdate = true;
    gCol.needsUpdate = true;
    gSz.needsUpdate = true;
  }, [nodes.length, base, neighborSets]);

  useEffect(() => {
    hoveredRef.current = null;
    applyHover(null);
  }, [applyHover]);

  const setHovered = useCallback((index: number | null) => {
    if (hoveredRef.current === index) return;
    hoveredRef.current = index;
    applyHover(index);
  }, [applyHover]);

  // Edges: dim layer always (#4466aa, signature), lit overlay for the hovered node.
  const [litVersion, setLitVersion] = useState(0);
  const litRef = useRef<Float32Array>(new Float32Array(0));
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

  const updateLitEdges = useCallback((hovered: number | null) => {
    if (hovered == null) {
      litRef.current = new Float32Array(0);
      setLitVersion((v) => v + 1);
      return;
    }
    const hoveredId = nodes[hovered]?.id;
    const nodeMap = new Map(nodes.map((n, i) => [n.id, i]));
    const pts: number[] = [];
    for (const e of edges) {
      if (e.source !== hoveredId && e.target !== hoveredId) continue;
      const si = nodeMap.get(e.source);
      const ti = nodeMap.get(e.target);
      if (si == null || ti == null) continue;
      pts.push(
        nodes[si].position[0], nodes[si].position[1], nodes[si].position[2],
        nodes[ti].position[0], nodes[ti].position[1], nodes[ti].position[2],
      );
    }
    litRef.current = new Float32Array(pts);
    setLitVersion((v) => v + 1);
  }, [nodes, edges]);

  // Idle-only auto-rotate: start after 5s of no interaction, ease in over 3s.
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
      <StarFieldLite />

      <ZoomToFit signal={fitSignal} nodes={nodes} controlsRef={controlsRef} />

      {/* Dim edges — signature steel-blue */}
      {edgePositions.length > 0 && (
        <lineSegments key={`edges-${edgePositions.length}`} raycast={() => null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[edgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#4466aa" transparent opacity={0.16} depthWrite={false} />
        </lineSegments>
      )}

      {/* Lit edges for the hovered node — accent */}
      {litRef.current.length > 0 && (
        <lineSegments key={`lit-${litVersion}`} raycast={() => null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[litRef.current, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={accent} transparent opacity={0.85} depthWrite={false} />
        </lineSegments>
      )}

      {/* Glow layer (additive, large soft points) */}
      {nodes.length > 0 && (
        <points key={`glow-${nodes.length}`} ref={glowRef} material={glowMat} raycast={() => null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[base.pos, 3]} />
            <bufferAttribute attach="attributes-color" args={[new Float32Array(base.col), 3]} />
            <bufferAttribute attach="attributes-size" args={[new Float32Array(base.gsz), 1]} />
          </bufferGeometry>
        </points>
      )}

      {/* Core nodes — interactive layer */}
      {nodes.length > 0 && (
        <points
          key={`core-${nodes.length}`}
          ref={coreRef}
          material={coreMat}
          onPointerMove={(e: any) => {
            e.stopPropagation();
            markInteraction();
            if (e.index != null && e.index < nodes.length) {
              setHovered(e.index);
              updateLitEdges(e.index);
              onHover({ index: e.index, clientX: e.clientX, clientY: e.clientY });
              document.body.style.cursor = 'pointer';
            }
          }}
          onPointerOut={(e: any) => {
            e.stopPropagation();
            setHovered(null);
            updateLitEdges(null);
            onHover(null);
            document.body.style.cursor = 'default';
          }}
          onClick={(e: any) => {
            e.stopPropagation();
            if (e.index != null && nodes[e.index]) onNodeClick(nodes[e.index]);
          }}
        >
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[base.pos, 3]} />
            <bufferAttribute attach="attributes-color" args={[new Float32Array(base.col), 3]} />
            <bufferAttribute attach="attributes-size" args={[new Float32Array(base.sz), 1]} />
          </bufferGeometry>
        </points>
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

// ─── BFS for local graph ─────────────────────────────

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
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        // Signature deep-space backdrop (Graph3D.tsx)
        background: 'radial-gradient(ellipse at center, #0d1028 0%, #080c1a 40%, #040610 100%)',
      }}
    >
      <GraphErrorBoundary>
        <Canvas
          camera={{ position: [0, 50, 200], fov: 55 }}
          style={{ background: 'transparent' }}
          gl={{ antialias: true, alpha: true }}
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

      {/* Controls overlay: [Global|Local] + depth slider + zoom-to-fit */}
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

      {/* Hover label — HTML overlay, no troika/CDN fonts */}
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
