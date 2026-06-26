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
  const setGraphData = useGraphStore((s) => s.setGraphData);

  useEffect(() => {
    // Swap-sensitive signature. The old dep was the BOOLEAN `[nodes.length > 0]`, which does
    // NOT change on a raw↔cluster↔drilldown swap (both true) → the effect never re-ran and
    // ranRef reset was dead. This signature changes on node-count change, first-node-id change
    // (drilldown / cluster→raw), AND view change → the worker re-layouts those swaps.
    const sig = `${nodes.length}:${nodes[0]?.id ?? ''}:${view}`;
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      ranRef.current = false; // new node-set → allow a fresh layout pass
    }

    // The cluster SUPER-NODE view carries baked galaxy positions from the server — never
    // re-layout it (detect by isCluster, NOT by view: a drilldown keeps view='cluster' but
    // swaps in member nodes that have NO server positions and DO need the worker). Also skip
    // an empty set. Raw + drilled-down members fall through to the worker.
    if (nodes[0]?.isCluster || nodes.length === 0) return;
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
        setGraphData(updated, currentState.edges, currentState.clusters);
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
  }, [nodes.length, nodes[0]?.id, view, edges, setGraphData]);
}
