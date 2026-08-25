// Force layout — 첫 로드 시 1회만 실행, 모드 전환 시 재실행 안 함

import { useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

export function useLayout() {
  const ranRef = useRef(false);
  const sigRef = useRef<string>('');
  const workerRef = useRef<Worker | null>(null);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const view = useGraphStore((s) => s.view);
  const sceneBaked = useGraphStore((s) => s.sceneBaked);
  const applyLayoutPositions = useGraphStore((s) => s.applyLayoutPositions);

  useEffect(() => {
    // Swap-sensitive signature. The old dep was the BOOLEAN `[nodes.length > 0]`, which does
    // NOT change on a raw↔cluster↔drilldown swap (both true) → the effect never re-ran and
    // ranRef reset was dead. This signature changes on node-count change, first-node-id change
    // (drilldown / cluster→raw), AND view change → the worker re-layouts those swaps.
    const sig = `${nodes.length}:${nodes[0]?.id ?? ''}:${view}:${sceneBaked}`;
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      ranRef.current = false; // new node-set → allow a fresh layout pass
    }

    // 서버가 위치를 구워 보낸 씬(클러스터 갤럭시)은 다시 배치하지 않는다.
    //
    // 예전 판정은 `nodes[0]?.isCluster` 였다 — "0번 노드가 슈퍼노드인가" 라는 위치 의존 검사라,
    // 슈퍼노드와 일반 노트가 섞인 씬(폴더 하위 드릴다운)에서는 0번이 무엇이냐에 따라 레이아웃이
    // 통째로 스킵돼 전부 원점에 겹친다. 스토어의 명시 플래그로 바꿨다.
    if (sceneBaked || nodes.length === 0) return;
    if (ranRef.current) return;
    ranRef.current = true;

    // Terminate any in-flight worker from a prior node-set before spawning a new one, so
    // toggling raw↔drilldown doesn't accumulate orphaned layout Workers.
    workerRef.current?.terminate();
    const worker = new Worker(
      new URL('../lib/layout.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, positions } = e.data;
      if (type === 'progress' || type === 'done') {
        // 위치만 업데이트, 현재 클러스터 유지
        const currentState = useGraphStore.getState();
        const updated = currentState.nodes.map((n, i) => ({
          ...n,
          position: positions[i] as [number, number, number],
        }));
        applyLayoutPositions(updated);
      }
      if (type === 'done') worker.terminate();
    };

    // Drilldown (cluster view with member nodes — super-nodes already returned above) lays the
    // members out in a COMPACT ellipsoid, smaller than the cluster galaxy's body. Otherwise the
    // members spread across the default ~250-radius volume, so fitView has to pull the camera way
    // back to frame them → clicking a cluster read as a zoom-OUT. A small volume lets the camera
    // dolly IN, so entering a cluster feels like flying into it. Raw view keeps the wide spread.
    const isDrilldown = view === 'cluster';
    worker.postMessage({
      type: 'init',
      nodes: nodes.map(n => ({ id: n.id, clusterId: n.clusterId, size: n.size })),
      edges,
      // Drilldown: a COMPACT ellipsoid at the DEFAULT (stable) repulsion. Compact so the member
      // framing ends up CLOSER than the galaxy → entering a cluster is a real zoom-IN (single
      // clean dolly, no fragile multi-stage cinematic). Default repulsion keeps the nodes evenly
      // spread (no clumping → no "mould" of overlapping glow halos); higher repulsion blew the sim
      // up (NaN / nodes flung to infinity).
      // [58,43,50] is about the smallest STABLE ellipsoid: smaller and the default repulsion makes
      // near-coincident members explode (NaN / nodes flung off). This gives r≈75 → a framing closer
      // than the galaxy (a real zoom-in) while staying numerically safe and evenly spread (no mould).
      options: isDrilldown
        ? { brainScale: [58, 43, 50] as [number, number, number] }
        : undefined,
    });

    return () => worker.terminate();
  }, [nodes.length, nodes[0]?.id, view, sceneBaked, edges, applyLayoutPositions]);
}
