// Shared graph visual language — single source of truth for the SIGNATURE
// Stellavault look used by BOTH the right-side GraphPanel and the full-tab
// GraphView. Ported from @stellavault/graph (GraphNodes/GraphEdges/StarField/
// Graph3D):
//   - deep-space radial gradient background (#0d1028 → #080c1a → #040610)
//   - star field + nebula sprites
//   - nodes as TWO point layers: additive glow + bright core, radial-gradient
//     circle texture, 15-color cluster palette, brightness boost by size
//   - hover: node → white ×2.5, connected neighbors brighten, the rest fade
//   - edges: dim #4466aa lines, hovered node's edges lit in accent
// Per-vertex point size needs a tiny ShaderMaterial (PointsMaterial ignores the
// size attribute) — raycasting still works (THREE.Points raycast is material-free).

import { Component, useMemo } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────

// Shape actually sent by core.buildGraphData over IPC (§4-F: position is NEVER sent).
export interface CoreGraphNode {
  id: string;
  label?: string;
  title?: string;        // tolerated legacy shape
  filePath: string;
  clusterId?: number;
  cluster?: number;      // tolerated legacy shape
  size?: number;
}

export interface GraphNode {
  id: string;
  title: string;
  filePath: string;
  cluster: number;
  size: number;
  position: [number, number, number];
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface HoverInfo {
  index: number;
  clientX: number;
  clientY: number;
}

// 15-color palette — identical to @stellavault/graph GraphNodes.tsx
export const PALETTE: number[][] = [
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
export const MAX_GLOBAL_NODES = 3000;

// Signature deep-space backdrop (Graph3D.tsx).
export const DEEP_SPACE_BG =
  'radial-gradient(ellipse at center, #0d1028 0%, #080c1a 40%, #040610 100%)';

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

export const circleTexture = createCircleTexture();
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

export function makePointsMaterial(opacity: number, additive: boolean): THREE.ShaderMaterial {
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

export function hash32(str: string): number {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sphericalPoint(rng: () => number, radius: number): [number, number, number] {
  const theta = rng() * Math.PI * 2;
  const phi = Math.acos(2 * rng() - 1);
  const r = Math.cbrt(rng()) * radius;
  return [
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.sin(phi) * Math.sin(theta),
    r * Math.cos(phi),
  ];
}

export function seededPosition(id: string, cluster: number): [number, number, number] {
  // Cluster center on a deterministic shell, node jittered around it → visible grouping.
  const c = sphericalPoint(mulberry32(hash32(`cluster:${cluster}`)), 1);
  const center: [number, number, number] = [c[0] * 70, c[1] * 70, c[2] * 70];
  const offset = sphericalPoint(mulberry32(hash32(id)), 45);
  return [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]];
}

export function mapCoreNodes(raw: CoreGraphNode[]): GraphNode[] {
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

export function readAccentColor(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return v || '#6366f1';
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

// ─── Base buffers — signature recipe: palette by cluster + brightness boost by size ───

export interface BaseBuffers {
  pos: Float32Array;
  col: Float32Array;
  sz: Float32Array;
  gsz: Float32Array;
}

export function buildBaseBuffers(nodes: GraphNode[]): BaseBuffers {
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
}

// Adjacency (index-based) for hover neighbor highlight.
export function buildNeighborSets(nodes: GraphNode[], edges: GraphEdge[]): Map<number, Set<number>> {
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
}

// Imperative hover styling — no buffer realloc, restore from base arrays.
// Hovered → white ×2.5, neighbors brighten ×1.6, the rest fade to 6%.
export function applyHoverToBuffers(
  core: THREE.Points | null,
  glow: THREE.Points | null,
  base: BaseBuffers,
  neighborSets: Map<number, Set<number>>,
  hovered: number | null,
  count: number,
): void {
  if (!core || !glow) return;
  const cCol = core.geometry.getAttribute('color') as THREE.BufferAttribute;
  const cSz = core.geometry.getAttribute('size') as THREE.BufferAttribute;
  const gCol = glow.geometry.getAttribute('color') as THREE.BufferAttribute;
  const gSz = glow.geometry.getAttribute('size') as THREE.BufferAttribute;
  const { col, sz, gsz } = base;
  const neighbors = hovered != null ? neighborSets.get(hovered) : undefined;
  for (let i = 0; i < count; i++) {
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
}

// ─── BFS for local graph ─────────────────────────────

export function bfsFilter(nodes: GraphNode[], edges: GraphEdge[], startId: string, depth: number): {
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

// ─── Error boundary ──────────────────────────────────

export class GraphErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
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

export function StarFieldLite() {
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
