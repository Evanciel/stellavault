// 빛 입자 탐색 — 방문 순서만 계산, 실제 애니메이션은 PulseAnimator에서

import { useRef, useCallback } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

export interface PulseData {
  visitOrder: string[];
  positions: Map<string, [number, number, number]>;
  running: boolean;
}

// Scene 내부 PulseAnimator가 읽을 수 있도록 전역 ref
export let pulseData: PulseData = { visitOrder: [], positions: new Map(), running: false };

export function usePulse() {
  const startPulse = useCallback((startId: string) => {
    const { edges, nodes } = useGraphStore.getState();

    // BFS
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      if (!adj.has(e.target)) adj.set(e.target, []);
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }

    const visited = new Set<string>();
    const visitOrder: string[] = [];
    const queue = [startId];
    visited.add(startId);
    while (queue.length > 0 && visitOrder.length < 50) {
      const id = queue.shift()!;
      visitOrder.push(id);
      for (const nid of (adj.get(id) ?? [])) {
        if (!visited.has(nid)) { visited.add(nid); queue.push(nid); }
      }
    }

    const positions = new Map(nodes.map(n => [n.id, (n.position ?? [0, 0, 0]) as [number, number, number]]));

    pulseData = { visitOrder, positions, running: true };

    // 시작 노드 점등 (기존 하이라이트 유지하지 않고 pulse용으로 리셋)
    useGraphStore.getState().setHighlightedNodes([startId]);
    useGraphStore.getState().setPulseParticlePos(positions.get(startId) ?? [0, 0, 0]);
    // 선택 유지 (노드 라벨이 사라지지 않도록)
    useGraphStore.getState().selectNode(startId);
  }, []);

  const stopPulse = useCallback(() => {
    pulseData = { visitOrder: [], positions: new Map(), running: false };
    useGraphStore.getState().setHighlightedNodes([]);
    useGraphStore.getState().setPulseParticlePos(null);
  }, []);

  return { startPulse, stopPulse };
}
