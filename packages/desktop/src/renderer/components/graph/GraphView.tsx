// Full main-pane graph view (tab kind 'graph') — the Obsidian-style graph:
// the SIGNATURE Stellavault visuals (graph-core.tsx, shared with GraphPanel)
// driven by a LIVE force-directed 3D simulation (force-sim.ts):
//   - continuous velocity-Verlet sim ticking in useFrame, alpha cooling,
//     re-heated by drag / slider changes / new data
//   - node drag (raycast against a camera-facing plane) pins during drag,
//     releases on pointer-up
//   - collapsible Forces overlay: Repel / Link force / Center force /
//     Link distance sliders, wired live to the sim
//   - HTML overlay labels for the top-N largest nodes, distance-faded
// Opened via app-store openGraphTab() ('graph.open-view', mod+g, titlebar ◉).

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { ipc } from '../../lib/ipc-client.js';
import { useAppStore } from '../../stores/app-store.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import {
  type CoreGraphNode, type GraphNode, type GraphEdge, type HoverInfo,
  MAX_GLOBAL_NODES, DEEP_SPACE_BG,
  mapCoreNodes, readAccentColor,
  buildBaseBuffers, buildNeighborSets, applyHoverToBuffers,
  makePointsMaterial, StarFieldLite, GraphErrorBoundary,
} from './graph-core.js';
import { ForceSim, DEFAULT_SIM_SETTINGS, type SimSettings } from './force-sim.js';

// T2-9: zoom-adaptive labels. We keep a POOL of DOM label elements for the
// top-N largest nodes; how many are actually shown scales with zoom (camera
// distance) — only the biggest few when zoomed out, up to the whole pool when
// zoomed in. So the graph isn't cluttered far out but is legible up close.
const LABEL_POOL = 60;         // top-N largest nodes get a (possibly hidden) DOM label
const LABEL_MIN_VISIBLE = 8;   // always show at least this many (biggest)
const LABEL_NEAR = 140;        // full opacity / max labels within this camera distance
const LABEL_FAR = 600;         // invisible beyond this (also raised for 2D zoom-out)

// ─── Scene ───────────────────────────────────────────

function ForceScene({ nodes, edges, accent, fitSignal, settingsRef, reheatSignal, mode2d, onNodeClick, onHover, labelEls, labelRank }: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  accent: string;
  fitSignal: number;
  settingsRef: React.MutableRefObject<SimSettings>;
  reheatSignal: number;
  mode2d: boolean;
  onNodeClick: (node: GraphNode) => void;
  onHover: (info: HoverInfo | null) => void;
  labelEls: React.MutableRefObject<Map<number, HTMLDivElement>>;
  // T2-9: index → size rank (0 = largest). Drives zoom-adaptive label cutoff.
  labelRank: React.MutableRefObject<Map<number, number>>;
}) {
  const coreRef = useRef<THREE.Points>(null);
  const glowRef = useRef<THREE.Points>(null);
  const edgesRef = useRef<THREE.LineSegments>(null);
  const litRef = useRef<THREE.LineSegments>(null);
  const controlsRef = useRef<any>(null);
  const hoveredRef = useRef<number | null>(null);
  const draggingRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  const userMovedRef = useRef(false);   // user grabbed the camera → pause auto-fit
  const lastMovedRef = useRef(true);    // edge-detect sim settle for a final auto-fit
  const syncedRef = useRef(false);      // force ONE node+edge buffer sync after the sim
                                        // (re)creates — else a frozen galaxy leaves edges at origin
  const { camera, gl, raycaster, size } = useThree();

  // Points raycast precision — without this hover triggers meters away.
  useEffect(() => {
    const prev = raycaster.params.Points?.threshold;
    raycaster.params.Points = { threshold: 3.5 };
    return () => { raycaster.params.Points = { threshold: prev ?? 1 }; };
  }, [raycaster]);

  const base = useMemo(() => buildBaseBuffers(nodes), [nodes]);
  // Stable typed-array copies backing the point-cloud bufferAttributes. CRITICAL:
  // passing an inline `new Float32Array(base.pos)` into <bufferAttribute args>
  // makes R3F RECONSTRUCT the attribute on EVERY React re-render (args is shallow-
  // compared and a fresh array is a new reference each render). That silently
  // resets node positions to the seeded layout; the frame loop only repairs it
  // while the sim is still moving. Once the sim rests — or the galaxy is frozen —
  // a re-render (hover fires setHover per pointermove) leaves the points stuck at
  // the seed positions: the "nodes suddenly clump to the center on hover" bug.
  // Memoizing on `base` keeps the reference stable across hover re-renders so the
  // buffers we mutate in place (frame loop + applyHover) survive.
  const coreAttrs = useMemo(
    () => ({ pos: new Float32Array(base.pos), col: new Float32Array(base.col), sz: new Float32Array(base.sz) }),
    [base],
  );
  const glowAttrs = useMemo(
    () => ({ pos: new Float32Array(base.pos), col: new Float32Array(base.col), sz: new Float32Array(base.gsz) }),
    [base],
  );
  const neighborSets = useMemo(() => buildNeighborSets(nodes, edges), [nodes, edges]);

  // Index pairs for the sim + edge buffer (shared layout: link k → floats k*6..k*6+5).
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

  // The simulation — starts from the current hash-seeded positions.
  // The galaxy (cluster super-nodes) uses a precomputed even (Fibonacci) layout that the
  // live sim must NOT collapse into a hub-and-spoke — freeze it. Expanded clusters' members
  // run the sim normally so they spread out.
  const isGalaxy = useMemo(() => nodes.length > 0 && nodes.every((n) => n.id.startsWith('__cluster__')), [nodes]);
  const sim = useMemo(() => {
    const s = new ForceSim(base.pos, linkPairs);
    if (isGalaxy) {
      s.freeze();
    } else {
      s.reheat(0.3);
      s.cool(); // start hot (alpha=1) but cooling toward rest
    }
    return s;
  }, [base, linkPairs, isGalaxy]);

  // Re-sync the GPU buffers once whenever the sim is rebuilt (data / expand / 2D change) —
  // critical when the galaxy sim is frozen (moved stays false → buffers never update).
  useEffect(() => { syncedRef.current = false; }, [sim]);

  // Slider change → reheat (Obsidian: settings change restarts the sim).
  useEffect(() => {
    if (reheatSignal > 0) sim.reheat(0.3);
    const t = setTimeout(() => sim.cool(), 600);
    return () => clearTimeout(t);
  }, [reheatSignal, sim]);

  // T2-9: 2D ↔ 3D — constrain/release the z axis (setFlat reheats internally).
  useEffect(() => {
    sim.setFlat(mode2d);
    const t = setTimeout(() => sim.cool(), 800);
    return () => clearTimeout(t);
  }, [mode2d, sim]);

  const edgePositions = useMemo(
    () => new Float32Array(linkPairs.length * 6),
    [linkPairs],
  );
  // Lit overlay reuses the same max-size buffer + drawRange.
  const litPositions = useMemo(
    () => new Float32Array(Math.max(1, linkPairs.length) * 6),
    [linkPairs],
  );
  const litLinksRef = useRef<number[]>([]);

  const coreMat = useMemo(() => makePointsMaterial(0.95, false), []);
  // Glow opacity kept modest: with up to 3000 additive glow points a higher value
  // saturates large vaults to white (esp. in packed 2D / zoomed views).
  const glowMat = useMemo(() => makePointsMaterial(0.18, true), []);

  const applyHover = useCallback((hovered: number | null) => {
    applyHoverToBuffers(coreRef.current, glowRef.current, base, neighborSets, hovered, nodes.length);
    // Lit edge subset for the hovered node.
    const lit: number[] = [];
    if (hovered != null) {
      for (let k = 0; k < linkPairs.length; k++) {
        if (linkPairs[k][0] === hovered || linkPairs[k][1] === hovered) lit.push(k);
      }
    }
    litLinksRef.current = lit;
    if (litRef.current) litRef.current.geometry.setDrawRange(0, lit.length * 2);
  }, [base, neighborSets, nodes.length, linkPairs]);

  useEffect(() => {
    hoveredRef.current = null;
    applyHover(null);
  }, [applyHover]);

  const setHovered = useCallback((index: number | null) => {
    if (hoveredRef.current === index) return;
    hoveredRef.current = index;
    applyHover(index);
  }, [applyHover]);

  // ── Node drag: raycast onto a camera-facing plane through the node ──
  const dragPlane = useMemo(() => new THREE.Plane(), []);
  const dragVec = useMemo(() => new THREE.Vector3(), []);

  const startDrag = useCallback((index: number) => {
    draggingRef.current = index;
    if (controlsRef.current) controlsRef.current.enabled = false;
    const p = new THREE.Vector3(sim.pos[index * 3], sim.pos[index * 3 + 1], sim.pos[index * 3 + 2]);
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    dragPlane.setFromNormalAndCoplanarPoint(normal, p);
    sim.reheat(0.3); // d3: alphaTarget(0.3).restart() on dragstart
    gl.domElement.style.cursor = 'grabbing';

    const onMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(dragPlane, dragVec)) {
        sim.pin(index, dragVec.x, dragVec.y, dragVec.z);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      draggingRef.current = null;
      sim.unpin();  // float free again — no permanent pinning (Obsidian behavior)
      sim.cool();
      if (controlsRef.current) controlsRef.current.enabled = true;
      gl.domElement.style.cursor = 'default';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [sim, camera, gl, raycaster, dragPlane, dragVec]);

  // ── Zoom to fit (uses LIVE sim positions) ──
  const fitToView = useCallback(() => {
    if (sim.n === 0) return;
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < sim.n; i++) {
      box.expandByPoint(v.set(sim.pos[i * 3], sim.pos[i * 3 + 1], sim.pos[i * 3 + 2]));
    }
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(20, box.getSize(new THREE.Vector3()).length() / 2);
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      // T2-9: ortho fit — look straight down z, set zoom from the viewport span.
      const ortho = camera as THREE.OrthographicCamera;
      camera.position.set(center.x, center.y, center.z + Math.max(radius * 2, 300));
      camera.lookAt(center);
      const span = Math.max(ortho.right - ortho.left, ortho.top - ortho.bottom) || size.height;
      ortho.zoom = Math.max(0.3, Math.min(3, span / (radius * 2.4)));
      ortho.updateProjectionMatrix();
    } else {
      const fov = ((camera as THREE.PerspectiveCamera).fov ?? 55) * (Math.PI / 180);
      const dist = (radius / Math.tan(fov / 2)) * 1.2;
      camera.position.set(center.x, center.y + radius * 0.3, center.z + dist);
      camera.lookAt(center);
    }
    if (controlsRef.current) {
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  }, [sim, camera, size]);

  // Explicit fit (button) or camera-type switch → re-enable auto-fit + frame now.
  useEffect(() => {
    userMovedRef.current = false;
    lastMovedRef.current = true;
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal, mode2d]);

  // ── Main loop: tick sim → write buffers → labels ──
  useFrame((_state, delta) => {
    frameRef.current++;
    const dtScale = Math.min(Math.max(delta * 60, 0.25), 2); // clamp dt
    const moved = sim.tick(settingsRef.current, dtScale);

    // Auto-fit the camera while the layout settles so the graph never blooms out of
    // view ("박살"). Stops the moment the user grabs the camera (OrbitControls onStart);
    // a final fit lands when the sim first reaches rest.
    if (!userMovedRef.current) {
      if (moved && frameRef.current % 8 === 0) fitToView();
      else if (!moved && lastMovedRef.current) fitToView();
    }
    lastMovedRef.current = moved;

    if (moved || !syncedRef.current) {
      const core = coreRef.current;
      const glow = glowRef.current;
      if (core && glow) {
        const cPos = core.geometry.getAttribute('position') as THREE.BufferAttribute;
        const gPos = glow.geometry.getAttribute('position') as THREE.BufferAttribute;
        (cPos.array as Float32Array).set(sim.pos);
        (gPos.array as Float32Array).set(sim.pos);
        cPos.needsUpdate = true;
        gPos.needsUpdate = true;
        core.geometry.computeBoundingSphere();
      }
      // Edges follow nodes.
      const edgeSeg = edgesRef.current;
      if (edgeSeg) {
        const attr = edgeSeg.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        const p = sim.pos;
        for (let k = 0; k < linkPairs.length; k++) {
          const [a, b] = linkPairs[k];
          const o = k * 6;
          arr[o] = p[a * 3]; arr[o + 1] = p[a * 3 + 1]; arr[o + 2] = p[a * 3 + 2];
          arr[o + 3] = p[b * 3]; arr[o + 4] = p[b * 3 + 1]; arr[o + 5] = p[b * 3 + 2];
        }
        attr.needsUpdate = true;
      }
      syncedRef.current = true;
    }

    // Lit edges track the hovered node every frame (cheap — few links).
    const litSeg = litRef.current;
    if (litSeg && litLinksRef.current.length > 0) {
      const attr = litSeg.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const p = sim.pos;
      litLinksRef.current.forEach((k, idx) => {
        const [a, b] = linkPairs[k];
        const o = idx * 6;
        arr[o] = p[a * 3]; arr[o + 1] = p[a * 3 + 1]; arr[o + 2] = p[a * 3 + 2];
        arr[o + 3] = p[b * 3]; arr[o + 4] = p[b * 3 + 1]; arr[o + 5] = p[b * 3 + 2];
      });
      attr.needsUpdate = true;
    }

    // HTML labels — project every 3rd frame (throttled), distance fade.
    // T2-9: zoom-adaptive count. Derive a label budget from how zoomed-in we are
    // (ortho cameras have no perspective distance, so we use zoom; perspective
    // uses distance to the controls target). When zoomed in → reveal the whole
    // pool; zoomed out → only the biggest LABEL_MIN_VISIBLE. The per-node `rank`
    // (0 = largest) is compared against this budget.
    // Project labels EVERY frame (pool is capped at LABEL_POOL ≤60 → cheap) so they
    // track the dots exactly while the layout settles, instead of lagging 3 frames
    // behind the moving points ("labels don't line up with nodes").
    if (labelEls.current.size > 0) {
      const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
      // 0 (zoomed out) → 1 (zoomed in)
      let zoomT: number;
      if (ortho) {
        zoomT = Math.min(1, Math.max(0, ((camera as THREE.OrthographicCamera).zoom - 0.4) / (3 - 0.4)));
      } else {
        const target = controlsRef.current?.target as THREE.Vector3 | undefined;
        const dist = target ? camera.position.distanceTo(target) : camera.position.length();
        zoomT = Math.min(1, Math.max(0, (LABEL_FAR - dist) / (LABEL_FAR - LABEL_NEAR)));
      }
      const budget = Math.round(LABEL_MIN_VISIBLE + zoomT * (LABEL_POOL - LABEL_MIN_VISIBLE));
      const v = new THREE.Vector3();
      for (const [idx, el] of labelEls.current) {
        const rank = labelRank.current.get(idx) ?? Number.MAX_SAFE_INTEGER;
        if (idx >= sim.n || rank >= budget) { el.style.opacity = '0'; continue; }
        v.set(sim.pos[idx * 3], sim.pos[idx * 3 + 1], sim.pos[idx * 3 + 2]);
        const dist = camera.position.distanceTo(v);
        v.project(camera);
        if (v.z > 1 || (!ortho && dist > LABEL_FAR)) {
          el.style.opacity = '0';
          continue;
        }
        const x = (v.x * 0.5 + 0.5) * size.width;
        const y = (-v.y * 0.5 + 0.5) * size.height;
        const fade = ortho ? 0.9 : 0.9 * Math.min(1, Math.max(0, (LABEL_FAR - dist) / (LABEL_FAR - LABEL_NEAR)));
        el.style.opacity = String(fade);
        el.style.transform = `translate(-50%, 0) translate(${x.toFixed(1)}px, ${(y + 8).toFixed(1)}px)`;
      }
    }
  });

  return (
    <>
      <StarFieldLite />

      {/* Dim edges — signature steel-blue */}
      {linkPairs.length > 0 && (
        <lineSegments key={`edges-${linkPairs.length}`} ref={edgesRef} raycast={() => null} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[edgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#4466aa" transparent opacity={0.16} depthWrite={false} />
        </lineSegments>
      )}

      {/* Lit edges for the hovered node — accent (drawRange-controlled) */}
      {linkPairs.length > 0 && (
        <lineSegments key={`lit-${linkPairs.length}`} ref={litRef} raycast={() => null} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[litPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={accent} transparent opacity={0.85} depthWrite={false} />
        </lineSegments>
      )}

      {/* Glow layer (additive, large soft points) */}
      {nodes.length > 0 && (
        <points key={`glow-${nodes.length}`} ref={glowRef} material={glowMat} raycast={() => null} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[glowAttrs.pos, 3]} />
            <bufferAttribute attach="attributes-color" args={[glowAttrs.col, 3]} />
            <bufferAttribute attach="attributes-size" args={[glowAttrs.sz, 1]} />
          </bufferGeometry>
        </points>
      )}

      {/* Core nodes — interactive layer */}
      {nodes.length > 0 && (
        <points
          key={`core-${nodes.length}`}
          ref={coreRef}
          material={coreMat}
          frustumCulled={false}
          onPointerMove={(e: any) => {
            e.stopPropagation();
            if (draggingRef.current != null) return;
            if (e.index != null && e.index < nodes.length) {
              setHovered(e.index);
              onHover({ index: e.index, clientX: e.clientX, clientY: e.clientY });
              document.body.style.cursor = 'pointer';
            }
          }}
          onPointerOut={(e: any) => {
            e.stopPropagation();
            if (draggingRef.current != null) return;
            setHovered(null);
            onHover(null);
            document.body.style.cursor = 'default';
          }}
          onPointerDown={(e: any) => {
            if (e.button !== 0) return;
            if (e.index != null && e.index < nodes.length) {
              e.stopPropagation();
              startDrag(e.index);
            }
          }}
          onClick={(e: any) => {
            e.stopPropagation();
            if (e.index != null && nodes[e.index]) onNodeClick(nodes[e.index]);
          }}
        >
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[coreAttrs.pos, 3]} />
            <bufferAttribute attach="attributes-color" args={[coreAttrs.col, 3]} />
            <bufferAttribute attach="attributes-size" args={[coreAttrs.sz, 1]} />
          </bufferGeometry>
        </points>
      )}

      {/* T2-9: swap camera by mode. makeDefault hands the active camera to R3F +
          OrbitControls. 2D = top-down orthographic (rotation disabled, pan/zoom
          only); 3D = the original perspective camera. */}
      {mode2d ? (
        <OrthographicCamera makeDefault position={[0, 0, 600]} zoom={1} near={0.1} far={4000} />
      ) : (
        <PerspectiveCamera makeDefault position={[0, 50, 200]} fov={55} near={0.1} far={4000} />
      )}

      <OrbitControls
        ref={controlsRef}
        onStart={() => { userMovedRef.current = true; }}
        enableDamping
        dampingFactor={0.08}
        minDistance={10}
        maxDistance={1500}
        rotateSpeed={0.5}
        enableRotate={!mode2d}
        // 2D: lock the view straight down the z axis (no orbit).
        {...(mode2d ? { minPolarAngle: 0, maxPolarAngle: 0 } : {})}
      />
    </>
  );
}

// ─── Forces overlay (Obsidian-style collapsible sliders) ───

function ForceSlider({ label, min, max, step, value, onChange, onCommit }: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  // T1-15: fired on pointer-up / change end → persist (avoids settings:set spam).
  onCommit?: () => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ink-dim)' }}>
      <span style={{ width: 86, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit?.()}
        onKeyUp={() => onCommit?.()}
        style={{ flex: 1, minWidth: 90 }}
        aria-label={label}
      />
      <span style={{ width: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </label>
  );
}

// ─── View ────────────────────────────────────────────

export function GraphView() {
  const [allNodes, setAllNodes] = useState<GraphNode[]>([]);
  const [allEdges, setAllEdges] = useState<GraphEdge[]>([]);
  // Wave 1 cluster-first LOD: clusters the user has expanded into their members.
  const expandedRef = useRef<Set<number>>(new Set());
  const [galaxyInfo, setGalaxyInfo] = useState<{ totalNodes: number; clusters: number } | null>(null);
  // Drill-down: the cluster currently opened to its members (null = galaxy view).
  const [drillCluster, setDrillCluster] = useState<{ id: number; label: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const [hover, setHover] = useState<{ title: string; x: number; y: number } | null>(null);
  const [forcesOpen, setForcesOpen] = useState(false);
  // T1-15: seed slider values from the persisted `graph` settings slice so they
  // survive graph reopen; fall back to DEFAULT_SIM_SETTINGS. Read lazily once.
  const [settings, setSettings] = useState<SimSettings>(() => {
    const g = useSettingsStore.getState().settings.graph;
    return g ? { ...DEFAULT_SIM_SETTINGS, ...g } : { ...DEFAULT_SIM_SETTINGS };
  });
  const [reheatSignal, setReheatSignal] = useState(0);
  // T2-9: 2D (flat, orthographic) vs 3D (default). Persisted only in-session.
  const [mode2d, setMode2d] = useState(false);
  const settingsRef = useRef<SimSettings>(settings);
  const labelEls = useRef<Map<number, HTMLDivElement>>(new Map());
  // T2-9: node index → size rank (0 = largest), consumed by the zoom-adaptive
  // label budget in the frame loop. Kept in a ref so it doesn't re-render.
  const labelRank = useRef<Map<number, number>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  const coreReady = useAppStore((s) => s.coreReady);
  const setPreviewNote = useAppStore((s) => s.setPreviewNote);
  const vaultPath = useAppStore((s) => s.vaultPath);

  const accent = useMemo(() => readAccentColor(), []);

  // Wave 1 cluster-first LOD: open at the galaxy (cluster super-nodes), NOT all 12k
  // notes. Clicking a super-node streams that cluster's members into the scene.
  const loadGalaxy = useCallback(async () => {
    if (!coreReady) return;
    setLoading(true);
    setDrillCluster(null);
    expandedRef.current.clear();
    try {
      const galaxy = await ipc('graph:clusters', { mode: 'semantic' });
      // Super-nodes carry their precomputed semantic position — use it directly
      // (NOT mapCoreNodes/seededPosition) so the frozen galaxy renders as laid out.
      const superNodes: GraphNode[] = galaxy.superNodes.map((sn) => ({
        id: `__cluster__${sn.clusterId}`,
        title: `${sn.label} · ${sn.memberCount}`,
        filePath: '',
        cluster: sn.clusterId,
        size: Math.min(8, Math.max(1, sn.size)),
        position: sn.position,
      }));
      setAllNodes(superNodes);
      setAllEdges(galaxy.metaEdges.map((me) => ({
        source: `__cluster__${me.sourceCluster}`,
        target: `__cluster__${me.targetCluster}`,
        weight: Math.max(0.1, Math.min(1, me.weight)),
      })));
      setGalaxyInfo({ totalNodes: galaxy.totalNodes, clusters: galaxy.superNodes.length });
      setFitSignal((s) => s + 1);
    } catch (err) {
      console.error('[graph] clusters build failed:', err);
      setAllNodes([]); setAllEdges([]); setGalaxyInfo(null);
    }
    setLoading(false);
  }, [coreReady]);

  // Wave 1 cluster-first LOD: open at the galaxy (cluster super-nodes), NOT all 12k
  // notes. Clicking a super-node drills into that cluster's members.
  useEffect(() => { void loadGalaxy(); }, [loadGalaxy]);

  // Global safety cap — same policy as GraphPanel.
  const { visibleNodes, visibleEdges } = useMemo(() => {
    // Galaxy view (drillCluster === null): render clusters as a clean constellation
    // with NO edges. The super-node positions already encode relatedness (semantic
    // layout), and the meta-edge web — especially lit-on-hover from a high-degree
    // hub — just swamps the overview. Edges return on drill-down (intra-cluster
    // links between a single cluster's member notes).
    const ids = new Set(allNodes.map((n) => n.id));
    const edges = drillCluster === null
      ? []
      // Always drop edges whose endpoints aren't in the node set — expand/collapse
      // mutates nodes + edges separately, so guard against a transient dangling edge.
      : allEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
    if (allNodes.length > MAX_GLOBAL_NODES) {
      const kept = [...allNodes].sort((a, b) => b.size - a.size).slice(0, MAX_GLOBAL_NODES);
      const keptIds = new Set(kept.map((n) => n.id));
      return {
        visibleNodes: kept,
        visibleEdges: edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target)),
      };
    }
    return { visibleNodes: allNodes, visibleEdges: edges };
  }, [allNodes, allEdges, drillCluster]);

  // Top-N largest nodes get a (possibly hidden) HTML label, positioned
  // imperatively by the scene. T2-9: pool is LABEL_POOL; the frame loop reveals
  // a zoom-dependent subset. We also record each node index's size rank so the
  // loop can apply the budget cutoff.
  const labelNodes = useMemo(() => {
    const ranked = visibleNodes
      .map((n, i) => ({ index: i, title: n.title, size: n.size }))
      .sort((a, b) => b.size - a.size)
      .slice(0, LABEL_POOL);
    const rankMap = new Map<number, number>();
    ranked.forEach((l, rank) => rankMap.set(l.index, rank));
    labelRank.current = rankMap;
    return ranked;
  }, [visibleNodes]);

  const updateSetting = useCallback((patch: Partial<SimSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      settingsRef.current = next;
      return next;
    });
    setReheatSignal((s) => s + 1); // slider change reheats the sim
  }, []);

  // T1-15: persist the current slider values into the `graph` settings slice.
  // Called on slider pointer-up (not per-tick) to avoid settings:set spam.
  const persistSettings = useCallback(() => {
    const s = settingsRef.current;
    void useSettingsStore.getState().update({
      graph: { repel: s.repel, link: s.link, center: s.center, linkDistance: s.linkDistance },
    });
  }, []);

  const handleNodeClick = useCallback(async (node: GraphNode) => {
    // Wave 1 drill-down: clicking a cluster super-node opens JUST that cluster —
    // its member notes + their internal edges. The sibling super-nodes and their
    // meta-edges (a dense linkDistance-110 web that swamps the whole view) are
    // dropped; "← All clusters" in the caption returns to the galaxy.
    const cm = /^__cluster__(\d+)$/.exec(node.id);
    if (cm) {
      const clusterId = Number(cm[1]);
      setLoading(true);
      try {
        const data = await ipc('graph:expand-cluster', { mode: 'semantic', clusterId });
        const memberNodes = mapCoreNodes(data.members as unknown as CoreGraphNode[]);
        setAllNodes(memberNodes);
        setAllEdges(data.intraEdges);
        setDrillCluster({ id: clusterId, label: node.title.replace(/\s·\s\d+$/, '') });
        setFitSignal((s) => s + 1);    // refit the camera to the opened cluster
        setReheatSignal((s) => s + 1); // settle the member layout
      } catch { /* leave the galaxy as-is on failure */ }
      setLoading(false);
      return;
    }
    if (!node.filePath) return;
    try {
      const isAbsolute = /^([a-zA-Z]:[\\/]|\/)/.test(node.filePath);
      const fullPath = isAbsolute ? node.filePath : `${vaultPath}/${node.filePath}`;
      const content = await ipc('vault:read-file', fullPath);
      // Web/Obsidian-style: stream into the right-panel READ-ONLY preview instead
      // of stealing the main pane (which is showing the graph). The preview's
      // "Open ↗" button opens a real editor tab when the user wants to edit.
      setPreviewNote({ filePath: fullPath, title: node.title, content });
    } catch { /* skip unreadable */ }
  }, [setPreviewNote, vaultPath]);

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
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-faint)', fontSize: 12, background: DEEP_SPACE_BG }}>
        {coreReady ? 'Building graph...' : 'Waiting for AI engine...'}
      </div>
    );
  }

  if (allNodes.length === 0) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-faint)', fontSize: 12, background: DEEP_SPACE_BG }}>
        No documents indexed. Run re-index from the AI panel.
      </div>
    );
  }

  const overlayButtonStyle: React.CSSProperties = {
    padding: '3px 10px',
    fontSize: 11,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    background: 'rgba(120,120,160,0.15)',
    color: 'var(--ink-dim)',
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: DEEP_SPACE_BG,
      }}
    >
      <GraphErrorBoundary>
        <Canvas
          style={{ background: 'transparent' }}
          gl={{ antialias: true, alpha: true }}
        >
          <ForceScene
            nodes={visibleNodes}
            edges={visibleEdges}
            accent={accent}
            fitSignal={fitSignal}
            settingsRef={settingsRef}
            reheatSignal={reheatSignal}
            mode2d={mode2d}
            onNodeClick={handleNodeClick}
            onHover={handleHover}
            labelEls={labelEls}
            labelRank={labelRank}
          />
        </Canvas>
      </GraphErrorBoundary>

      {/* HTML labels — top-N largest nodes, scene positions them imperatively */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {labelNodes.map((l) => (
          <div
            key={l.index}
            ref={(el) => {
              if (el) labelEls.current.set(l.index, el);
              else labelEls.current.delete(l.index);
            }}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              opacity: 0,
              maxWidth: 180,
              padding: '1px 6px',
              fontSize: 10.5,
              color: '#cdd3f0',
              textShadow: '0 1px 4px rgba(0,0,0,0.9)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              willChange: 'transform, opacity',
            }}
          >
            {l.title}
          </div>
        ))}
      </div>

      {/* Top-left controls: Fit + Forces (collapsible, Obsidian-style) */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '6px 8px',
        borderRadius: 8,
        background: 'rgba(10,10,20,0.72)',
        border: '1px solid rgba(120,120,200,0.18)',
        minWidth: forcesOpen ? 250 : undefined,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button style={overlayButtonStyle} title="Zoom to fit" onClick={() => setFitSignal((s) => s + 1)}>
            Fit
          </button>
          {/* T2-9: 2D ↔ 3D toggle */}
          <button
            style={{
              ...overlayButtonStyle,
              background: mode2d ? 'var(--accent)' : 'rgba(120,120,160,0.15)',
              color: mode2d ? '#fff' : 'var(--ink-dim)',
            }}
            title={mode2d ? 'Switch to 3D' : 'Switch to 2D (flat, top-down)'}
            onClick={() => setMode2d((m) => !m)}
            aria-pressed={mode2d}
          >
            {mode2d ? '2D' : '3D'}
          </button>
          <button
            style={{
              ...overlayButtonStyle,
              background: forcesOpen ? 'var(--accent)' : 'rgba(120,120,160,0.15)',
              color: forcesOpen ? '#fff' : 'var(--ink-dim)',
            }}
            onClick={() => setForcesOpen((o) => !o)}
            aria-expanded={forcesOpen}
          >
            Forces {forcesOpen ? '▾' : '▸'}
          </button>
        </div>
        {forcesOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
            <ForceSlider
              label="Repel force" min={0} max={20} step={1}
              value={settings.repel}
              onChange={(v) => updateSetting({ repel: v })}
              onCommit={persistSettings}
            />
            <ForceSlider
              label="Link force" min={0} max={1} step={0.05}
              value={settings.link}
              onChange={(v) => updateSetting({ link: v })}
              onCommit={persistSettings}
            />
            <ForceSlider
              label="Center force" min={0} max={1} step={0.05}
              value={settings.center}
              onChange={(v) => updateSetting({ center: v })}
              onCommit={persistSettings}
            />
            <ForceSlider
              label="Link distance" min={20} max={200} step={5}
              value={settings.linkDistance}
              onChange={(v) => updateSetting({ linkDistance: v })}
              onCommit={persistSettings}
            />
          </div>
        )}
      </div>

      {/* Hover tooltip — HTML overlay */}
      {hover && (
        <div style={{
          position: 'absolute',
          left: hover.x + 12,
          top: hover.y + 12,
          maxWidth: 280,
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
        left: 10,
        fontSize: 10,
        color: 'rgba(200,200,255,0.4)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        {drillCluster ? (
          <>
            <button
              onClick={() => { void loadGalaxy(); }}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                background: 'rgba(120,120,200,0.15)',
                border: '1px solid rgba(120,120,200,0.4)',
                borderRadius: 4,
                color: 'rgba(220,220,255,0.85)',
                fontSize: 10,
                padding: '2px 8px',
              }}
            >
              ← All clusters
            </button>
            <span>{drillCluster.label} · {visibleNodes.length} notes · drag · scroll to zoom</span>
          </>
        ) : (
          <span>
            {galaxyInfo
              ? `${galaxyInfo.totalNodes.toLocaleString()} notes · ${galaxyInfo.clusters} clusters · click a cluster to open`
              : `${visibleNodes.length} nodes · ${visibleEdges.length} edges`}
            {allNodes.length > MAX_GLOBAL_NODES && ` (top ${MAX_GLOBAL_NODES} of ${allNodes.length})`}
            {' '}· drag · scroll to zoom
          </span>
        )}
      </div>
    </div>
  );
}
