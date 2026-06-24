// Embedded 3D knowledge graph panel for the desktop app (right side panel).
// W1-8 functionality (Global|Local + BFS depth + zoom-to-fit + HTML hover label +
// ErrorBoundary + deterministic hash(id) layout + idle auto-rotate).
// All SIGNATURE visuals (textures, palette, point shader, star field, hover
// styling, deep-space bg) live in ../graph/graph-core.tsx — shared with the
// full-tab GraphView so the look stays in one place.

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { ipc } from '../../lib/ipc-client.js';
import { useT } from '../../lib/i18n.js';
import { useAppStore } from '../../stores/app-store.js';
import {
  type CoreGraphNode, type GraphNode, type GraphEdge, type HoverInfo,
  MAX_GLOBAL_NODES, DEEP_SPACE_BG,
  mapCoreNodes, readAccentColor, normalizePath, bfsFilter,
  buildBaseBuffers, buildNeighborSets, applyHoverToBuffers,
  makePointsMaterial, StarFieldLite, GraphErrorBoundary,
} from '../graph/graph-core.js';

// ─── Scene ───────────────────────────────────────────

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

  // Adjacency for hover neighbor highlight (shared builder).
  const neighborSets = useMemo(() => buildNeighborSets(nodes, edges), [nodes, edges]);

  // Base buffers — signature recipe: palette by cluster + brightness boost by size.
  const base = useMemo(() => buildBaseBuffers(nodes), [nodes]);
  // Stable copies of the mutable hover buffers (color/size). Inline new Float32Array
  // in <bufferAttribute args> gets rebuilt by R3F on every hover re-render, resetting
  // the imperative hover highlight (review: low). position uses base.pos directly —
  // this panel is static (no sim), so positions need no copy. Mirrors GraphView.
  const coreCol = useMemo(() => new Float32Array(base.col), [base]);
  const coreSz = useMemo(() => new Float32Array(base.sz), [base]);
  const glowCol = useMemo(() => new Float32Array(base.col), [base]);
  const glowSz = useMemo(() => new Float32Array(base.gsz), [base]);

  const coreMat = useMemo(() => makePointsMaterial(0.95, false), []);
  const glowMat = useMemo(() => makePointsMaterial(0.28, true), []);

  // Imperative hover styling — shared with GraphView (graph-core).
  const applyHover = useCallback((hovered: number | null) => {
    applyHoverToBuffers(coreRef.current, glowRef.current, base, neighborSets, hovered, nodes.length);
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
  // T2-10: hover used to rebuild a Map + a fresh Float32Array + force a React
  // re-render (setLitVersion) on EVERY pointermove → jank. Adopt the imperative
  // litLinksRef/drawRange pattern from GraphView: index pairs are computed once,
  // a single max-size lit buffer is reused, and hover only rewrites the buffer +
  // sets the geometry draw range. No allocations, no React state, on hover.
  const litRef = useRef<THREE.LineSegments>(null);

  // Index pairs for the dim + lit edge buffers (shared layout: link k →
  // floats k*6..k*6+5). Computed once per node/edge set.
  const linkPairs = useMemo(() => {
    const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));
    const pairs: Array<[number, number]> = [];
    for (const e of edges) {
      const a = idToIndex.get(e.source);
      const b = idToIndex.get(e.target);
      if (a == null || b == null || a === b) continue;
      pairs.push([a, b]);
    }
    return pairs;
  }, [nodes, edges]);

  // Static dim-edge positions (panel nodes don't move — no sim).
  const edgePositions = useMemo(() => {
    const arr = new Float32Array(linkPairs.length * 6);
    for (let k = 0; k < linkPairs.length; k++) {
      const [a, b] = linkPairs[k];
      const o = k * 6;
      arr[o] = nodes[a].position[0]; arr[o + 1] = nodes[a].position[1]; arr[o + 2] = nodes[a].position[2];
      arr[o + 3] = nodes[b].position[0]; arr[o + 4] = nodes[b].position[1]; arr[o + 5] = nodes[b].position[2];
    }
    return arr;
  }, [nodes, linkPairs]);

  // Lit overlay reuses a max-size buffer; drawRange controls how much is drawn.
  const litPositions = useMemo(
    () => new Float32Array(Math.max(1, linkPairs.length) * 6),
    [linkPairs],
  );

  // Imperatively fill the lit buffer for the hovered node + set drawRange.
  // No React re-render — runs on the same frame as the hover event.
  const updateLitEdges = useCallback((hovered: number | null) => {
    const seg = litRef.current;
    if (!seg) return;
    if (hovered == null) {
      seg.geometry.setDrawRange(0, 0);
      return;
    }
    const attr = seg.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    let count = 0;
    for (let k = 0; k < linkPairs.length; k++) {
      const [a, b] = linkPairs[k];
      if (a !== hovered && b !== hovered) continue;
      const o = count * 6;
      arr[o] = nodes[a].position[0]; arr[o + 1] = nodes[a].position[1]; arr[o + 2] = nodes[a].position[2];
      arr[o + 3] = nodes[b].position[0]; arr[o + 4] = nodes[b].position[1]; arr[o + 5] = nodes[b].position[2];
      count++;
    }
    attr.needsUpdate = true;
    seg.geometry.setDrawRange(0, count * 2);
  }, [nodes, linkPairs]);

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
      {linkPairs.length > 0 && (
        <lineSegments key={`edges-${linkPairs.length}`} raycast={() => null} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[edgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#4466aa" transparent opacity={0.16} depthWrite={false} />
        </lineSegments>
      )}

      {/* Lit edges for the hovered node — accent (drawRange-controlled, T2-10) */}
      {linkPairs.length > 0 && (
        <lineSegments key={`lit-${linkPairs.length}`} ref={litRef} raycast={() => null} frustumCulled={false}>
          <bufferGeometry drawRange={{ start: 0, count: 0 }}>
            <bufferAttribute attach="attributes-position" args={[litPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={accent} transparent opacity={0.85} depthWrite={false} />
        </lineSegments>
      )}

      {/* Glow layer (additive, large soft points) */}
      {nodes.length > 0 && (
        <points key={`glow-${nodes.length}`} ref={glowRef} material={glowMat} raycast={() => null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[base.pos, 3]} />
            <bufferAttribute attach="attributes-color" args={[glowCol, 3]} />
            <bufferAttribute attach="attributes-size" args={[glowSz, 1]} />
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
            <bufferAttribute attach="attributes-color" args={[coreCol, 3]} />
            <bufferAttribute attach="attributes-size" args={[coreSz, 1]} />
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

// ─── Panel ───────────────────────────────────────────

export function GraphPanel() {
  const [allNodes, setAllNodes] = useState<GraphNode[]>([]);
  const [allEdges, setAllEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'global' | 'local'>('global');
  const [depth, setDepth] = useState(1);
  const [fitSignal, setFitSignal] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [hover, setHover] = useState<{ title: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useT();

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
        {coreReady ? t('panel.graph.building') : t('panel.graph.waitingForAi')}
      </div>
    );
  }

  if (allNodes.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
        <div style={{ marginBottom: 12 }}>{t('panel.graph.noDocuments')}</div>
        <button
          disabled={indexing}
          onClick={async () => {
            setIndexing(true);
            try {
              await ipc('core:index');
              const data = await ipc('graph:build', 'semantic') as unknown as { nodes: CoreGraphNode[]; edges: GraphEdge[] };
              setAllNodes(mapCoreNodes(data.nodes ?? []));
              setAllEdges((data.edges ?? []) as GraphEdge[]);
            } catch (err) {
              console.error('[graph] index failed:', err);
            } finally {
              setIndexing(false);
            }
          }}
          style={{
            padding: '6px 14px', background: 'var(--accent)', border: 'none', borderRadius: 4,
            color: '#fff', fontSize: 12, cursor: indexing ? 'default' : 'pointer', opacity: indexing ? 0.6 : 1,
          }}
        >
          {indexing ? t('panel.graph.indexing') : t('panel.graph.runIndex')}
        </button>
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
        // Signature deep-space backdrop (graph-core).
        background: DEEP_SPACE_BG,
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
          {t('panel.graph.modeGlobal')}
        </button>
        <button style={toggleButtonStyle(mode === 'local')} onClick={() => setMode('local')}>
          {t('panel.graph.modeLocal')}
        </button>
        {mode === 'local' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--ink-dim)' }}>
            {t('panel.graph.depthLabel')}
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
          title={t('panel.graph.fitTooltip')}
          onClick={() => setFitSignal((s) => s + 1)}
        >
          {t('panel.graph.fitButton')}
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
          {t('panel.graph.noLocalNote')}
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
        {visibleNodes.length} {t('panel.graph.nodeEdgeCount', { edgeCount: visibleEdges.length })}
        {mode === 'global' && allNodes.length > MAX_GLOBAL_NODES && ` ${t('panel.graph.globalCapped', { maxGlobalNodes: MAX_GLOBAL_NODES, allNodesCount: allNodes.length })}`}
      </div>
    </div>
  );
}

