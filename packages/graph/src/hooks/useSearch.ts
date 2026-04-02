// 검색 → API → 노드 하이라이트 + 첫 결과로 카메라 이동

import { useCallback, useRef } from 'react';
import * as THREE from 'three';
import { fetchSearch } from '../api/client.js';
import { useGraphStore } from '../stores/graph-store.js';

function focusOnNode(nodeId: string) {
  const state = useGraphStore.getState();
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node?.position) return;

  const controls = (window as any).__sv_controls?.current;
  if (!controls) return;

  const target = new THREE.Vector3(...node.position);
  const startTarget = controls.target.clone();
  const startPos = controls.object.position.clone();
  const dir = startPos.clone().sub(target).normalize();
  const endPos = target.clone().add(dir.multiplyScalar(250));

  let t = 0;
  function animate() {
    t += 0.03;
    if (t > 1) t = 1;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    controls.target.lerpVectors(startTarget, target, ease);
    controls.object.position.lerpVectors(startPos, endPos, ease);
    controls.update();
    if (t < 1) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

export function useSearch() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((query: string) => {
    const { setSearchQuery, setHighlightedNodes } = useGraphStore.getState();
    setSearchQuery(query);

    if (!query.trim()) {
      setHighlightedNodes([]);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetchSearch(query, 20);
        const ids = (res.results ?? []).map((r: any) => r.documentId);
        useGraphStore.getState().setHighlightedNodes(ids);
        if (ids.length > 0) useGraphStore.getState().addSearchHistory(query);

        // 첫 번째 결과로 카메라 이동
        if (ids.length > 0) focusOnNode(ids[0]);
      } catch {
        useGraphStore.getState().setHighlightedNodes([]);
      }
    }, 300);
  }, []);

  const clearSearch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    useGraphStore.getState().setSearchQuery('');
    useGraphStore.getState().setHighlightedNodes([]);
    (window as any).__sv_resetCamera?.();
  }, []);

  return { search, clearSearch };
}
