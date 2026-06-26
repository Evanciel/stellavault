// R3F Canvas — 클릭 = mousedown/up 거리 판정 (R3F 이벤트 회피)

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GraphNodes } from './GraphNodes.js';
import { GraphEdges } from './GraphEdges.js';
import { ClusterLabels } from './ClusterLabels.js';
import { ClusterPlanets } from './ClusterPlanets.js';
import { StarField } from './StarField.js';
import { Tooltip } from './Tooltip.js';
import { PulseAnimator } from './PulseParticle.js';
import { ConstellationView } from './ConstellationView.js';
import { useGraphStore } from '../stores/graph-store.js';
import { useLayout } from '../hooks/useLayout.js';
import { usePulse } from '../hooks/usePulse.js';
import { useDecay } from '../hooks/useDecay.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.js';
import { ContextMenu } from './ContextMenu.js';

function Scene() {
  useLayout();
  useDecay(); // 감쇠 데이터 로딩
  useKeyboardNav(); // 키보드 그래프 탐색
  const { startPulse, stopPulse } = usePulse();

  // Expose Three.js scene + camera for E2E tests (scripts/pw-verify.mjs).
  // useThree() lives in the R3F Canvas context, so this is the only place
  // we can cleanly grab the root scene reference.
  const { scene, camera, gl } = useThree();
  useEffect(() => {
    (window as any).__sv_scene = scene;
    (window as any).__sv_camera = camera;
    (window as any).__sv_gl = gl;
    (window as any).__sv_store = useGraphStore;
  }, [scene, camera, gl]);
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const highlightedNodeIds = useGraphStore((s) => s.highlightedNodeIds);
  const theme = useGraphStore((s) => s.theme);
  const isLight = theme === 'light';
  const view = useGraphStore((s) => s.view);
  const controlsRef = useRef<any>(null);

  // Re-fit the camera whenever the view swaps (cluster<->raw). The new content has a
  // different extent, so without this the camera keeps the prior framing and the galaxy
  // looks shrunken/oversized on toggle-back (resetCamera animates to the standard origin
  // framing, content-independent). Skip the first mount — the initial framing is already set.
  const didFitMountRef = useRef(false);
  useEffect(() => {
    if (!didFitMountRef.current) { didFitMountRef.current = true; return; }
    // Only re-fit when landing on CLUSTER (raw→cluster is the toggle-back that looks shrunken).
    // Cluster positions are server-baked & clean; raw positions come from the async force worker
    // (transient NaN mid-sim), and raw's default framing is already fine — so don't fit raw.
    if (view !== 'cluster') return;
    const id = setTimeout(() => (window as any).__sv_fitView?.(), 350);
    return () => clearTimeout(id);
  }, [view]);

  const shouldSpin = !hoveredNodeId && !selectedNodeId && highlightedNodeIds.size === 0;

  useFrame(() => {
    const c = controlsRef.current;
    if (!c) return;
    // 녹화 중 자동 회전 (빠르게) 또는 기본 idle 회전
    const autoRotate = (window as any).__sv_autoRotate;
    if (autoRotate) {
      c.setAzimuthalAngle(c.getAzimuthalAngle() + 0.008);
      c.update();
    } else if (shouldSpin) {
      c.setAzimuthalAngle(c.getAzimuthalAngle() + 0.001);
      c.update();
    }
  });

  (window as any).__sv_pulse = startPulse;
  (window as any).__sv_stopPulse = stopPulse;
  (window as any).__sv_controls = controlsRef;

  return (
    <>
      <StarField />
      <GraphEdges />
      <GraphNodes />
      <ClusterPlanets />
      <ClusterLabels />
      <ConstellationView />
      <PulseAnimator />
      <Tooltip />
      <ambientLight intensity={isLight ? 0.8 : 0.4} />
      <pointLight position={[400, 300, 400]} intensity={isLight ? 0.3 : 0.6} color={isLight ? '#4466cc' : '#6688ff'} />
      <pointLight position={[-300, -200, 300]} intensity={isLight ? 0.2 : 0.4} color={isLight ? '#cc4466' : '#ff6688'} />
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
        minDistance={50}
        maxDistance={2000}
        rotateSpeed={0.5}
      />
    </>
  );
}

export function Graph3D() {
  const downPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      // 캔버스 위에서만 동작 (사이드패널 클릭 무시)
      const canvas = document.querySelector('canvas');
      if (!canvas?.contains(e.target as Node)) return;
      downPos.current = { x: e.clientX, y: e.clientY };
    }

    function onUp(e: MouseEvent) {
      if (!downPos.current) return;
      const dx = e.clientX - downPos.current.x;
      const dy = e.clientY - downPos.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      downPos.current = null;

      if (dist > 5) return;

      const state = useGraphStore.getState();
      // 클릭 시 항상 pulse 중단
      (window as any).__sv_stopPulse?.();

      // 약간의 지연을 둬서 R3F onClick이 먼저 처리되도록
      setTimeout(() => {
        const currentState = useGraphStore.getState();
        if (currentState.hoveredNodeId) {
          // Cluster super-node click → drill down. FULL-REPLACE the graph with this cluster's
          // members + intra-edges (desktop parity), instead of opening an empty NodeDetail.
          // members carry un-laid-out positions, so the full-replace changes nodes[0].id and
          // useLayout's swap-sensitive signature reheats the opened cluster via the worker.
          const m = /^cluster:(\d+)$/.exec(currentState.hoveredNodeId);
          const hovered = currentState.nodes.find((nn) => nn.id === currentState.hoveredNodeId);
          if (m || hovered?.isCluster) {
            const cid = m ? m[1] : String(hovered!.clusterId);
            const { mode, view, rawCap } = currentState;
            const capParam = view === 'raw' ? `&cap=${rawCap}` : '';
            currentState.setLoading(true);
            fetch(`/api/graph/cluster/${cid}?view=cluster&mode=${mode}${capParam}`)
              .then((r) => { if (!r.ok) throw new Error(`API error: ${r.status}`); return r.json(); })
              .then((json) => {
                const members = json.data;
                const s = useGraphStore.getState();
                s.selectNode(null);
                s.setGraphData(members.members ?? [], members.intraEdges ?? [], s.clusters);
                // members are re-laid-out by the worker (~1s) — content-fit once they've spread
                // so the opened cluster isn't left tiny under the galaxy's camera distance.
                setTimeout(() => (window as any).__sv_fitView?.(), 1100);
              })
              .catch((err) => useGraphStore.getState().setError(String(err)))
              .finally(() => useGraphStore.getState().setLoading(false));
            return;
          }
          if (currentState.selectedNodeId === currentState.hoveredNodeId) {
            currentState.selectNode(null);
          } else {
            currentState.selectNode(currentState.hoveredNodeId);
          }
        } else {
          // 빈 곳(노드 바깥) 클릭 → 선택 해제
          if (currentState.selectedNodeId) {
            currentState.selectNode(null);
          }
          // 하이라이트도 있으면 같이 해제 + 카메라 리셋
          if (currentState.highlightedNodeIds.size > 0) {
            currentState.setHighlightedNodes([]);
            (window as any).__sv_resetCamera?.();
          }
        }
      }, 10);
    }

    function resetCamera() {
      const controls = (window as any).__sv_controls?.current;
      if (!controls) return;
      const startTarget = controls.target.clone();
      const startPos = controls.object.position.clone();
      const endTarget = new THREE.Vector3(0, 0, 0);
      const endPos = new THREE.Vector3(0, 100, 600);
      let t = 0;
      function animate() {
        t += 0.03;
        if (t > 1) t = 1;
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        controls.target.lerpVectors(startTarget, endTarget, ease);
        controls.object.position.lerpVectors(startPos, endPos, ease);
        controls.update();
        if (t < 1) requestAnimationFrame(animate);
      }
      requestAnimationFrame(animate);
    }
    (window as any).__sv_resetCamera = resetCamera;

    // Content-aware fit: frame the CURRENT node set (cluster super-nodes are server-baked;
    // a fixed distance can't frame both the small cluster galaxy and the wide raw hairball,
    // so compute the bounding sphere and dolly to fit). Keeps the current view direction.
    function fitView() {
      const controls = (window as any).__sv_controls?.current;
      const cam = (window as any).__sv_camera as THREE.PerspectiveCamera | undefined;
      if (!controls || !cam) return;
      const pts = useGraphStore.getState().nodes
        .map((n: any) => n.position)
        .filter((p: any) => Array.isArray(p) && p.length === 3 && p.every((v: number) => Number.isFinite(v)));
      if (pts.length === 0) return;
      const cen = [0, 0, 0];
      for (const p of pts) { cen[0] += p[0]; cen[1] += p[1]; cen[2] += p[2]; }
      cen[0] /= pts.length; cen[1] /= pts.length; cen[2] /= pts.length;
      let maxR = 0;
      for (const p of pts) { const r = Math.hypot(p[0] - cen[0], p[1] - cen[1], p[2] - cen[2]); if (r > maxR) maxR = r; }
      if (!Number.isFinite(maxR) || maxR < 1) maxR = 100;
      const fov = ((cam.fov ?? 50) * Math.PI) / 180;
      // margin 1.1 ≈ the fresh-load framing (most clusters sit central with a few outliers at maxR,
      // so a tight margin fills the view like the initial paint rather than leaving a shrunken blob).
      const dist = Math.min(1900, (maxR * 1.1) / Math.tan(fov / 2)); // clamp < OrbitControls maxDistance
      const center = new THREE.Vector3(cen[0], cen[1], cen[2]);
      const dir = controls.object.position.clone().sub(controls.target).normalize();
      const endPos = center.clone().add(dir.multiplyScalar(dist));
      const startTarget = controls.target.clone();
      const startPos = controls.object.position.clone();
      let t = 0;
      function animate() {
        t += 0.03; if (t > 1) t = 1;
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        controls.target.lerpVectors(startTarget, center, ease);
        controls.object.position.lerpVectors(startPos, endPos, ease);
        controls.update();
        if (t < 1) requestAnimationFrame(animate);
      }
      requestAnimationFrame(animate);
    }
    (window as any).__sv_fitView = fitView;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      if (e.key === 'Escape') {
        const s = useGraphStore.getState();
        s.selectNode(null);
        s.setHighlightedNodes([]);
        s.setSearchQuery('');
        s.setPulseParticlePos(null);
        (window as any).__sv_stopPulse?.();
        resetCamera();
        // 검색창 blur
        (document.querySelector('input') as HTMLElement)?.blur();
        return;
      }

      if (isInput) return; // 입력 중에는 단축키 무시

      // / → 검색 포커스
      if (e.key === '/') {
        e.preventDefault();
        const input = document.querySelector('input[placeholder*="Search"]') as HTMLElement;
        input?.focus();
        return;
      }

      // Space → 선택된 노드 Explore
      if (e.key === ' ') {
        e.preventDefault();
        const s = useGraphStore.getState();
        if (s.selectedNodeId) {
          s.selectNode(null);
          setTimeout(() => (window as any).__sv_pulse?.(s.selectedNodeId), 100);
        }
        return;
      }

      // Tab → 다음 하이라이트 노드로 이동 (순환)
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = useGraphStore.getState();
        const highlighted = [...s.highlightedNodeIds];
        if (highlighted.length === 0) return;

        const currentIdx = s.selectedNodeId ? highlighted.indexOf(s.selectedNodeId) : -1;
        const nextIdx = (currentIdx + 1) % highlighted.length;
        const nextId = highlighted[nextIdx];
        s.selectNode(nextId);

        // 카메라 이동
        const node = s.nodes.find(n => n.id === nextId);
        if (node?.position) {
          const controls = (window as any).__sv_controls?.current;
          if (controls) {
            const tgt = new THREE.Vector3(...node.position);
            controls.target.copy(tgt);
            controls.update();
          }
        }
        return;
      }

      // N → Quick Capture (빠른 메모)
      if (e.key === 'n' || e.key === 'N') {
        window.dispatchEvent(new CustomEvent('sv-quick-capture'));
        return;
      }

      // T → 테마 토글
      if (e.key === 't' || e.key === 'T') {
        useGraphStore.getState().toggleTheme();
        return;
      }
    }

    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const theme = useGraphStore((s) => s.theme);
  const bgStyle = theme === 'dark'
    ? 'radial-gradient(ellipse at center, #0d1028 0%, #080c1a 40%, #040610 100%)'
    : 'radial-gradient(ellipse at center, #ffffff 0%, #f4f4f6 50%, #ebebef 100%)';

  return (
    <>
    <Canvas
      camera={{ position: [0, 100, 600], fov: 55, near: 1, far: 5000 }}
      raycaster={{ params: { Points: { threshold: 15 } } } as any}
      style={{ background: bgStyle }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
    >
      <Scene />
    </Canvas>
    <ContextMenu />
    </>
  );
}
