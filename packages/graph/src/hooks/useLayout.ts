// Force layout — 첫 로드 시 1회만 실행, 모드 전환 시 재실행 안 함

import { useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

export function useLayout() {
  const ranRef = useRef(false);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const clusters = useGraphStore((s) => s.clusters);
  const setGraphData = useGraphStore((s) => s.setGraphData);

  useEffect(() => {
    // 첫 로드에만 실행
    if (nodes.length === 0 || ranRef.current) return;
    ranRef.current = true;

    const worker = new Worker(
      new URL('../lib/layout.worker.ts', import.meta.url),
      { type: 'module' },
    );

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

    worker.postMessage({
      type: 'init',
      nodes: nodes.map(n => ({ id: n.id, clusterId: n.clusterId, size: n.size })),
      edges,
    });

    return () => worker.terminate();
  }, [nodes.length > 0]);
}
