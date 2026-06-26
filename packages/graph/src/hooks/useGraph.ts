// 그래프 데이터 로딩 — mode 전환 시 위치 유지, 색상만 변경

import { useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

export function useGraph() {
  const { setGraphData, setLoading, setError } = useGraphStore();
  const mode = useGraphStore((s) => s.mode);
  const view = useGraphStore((s) => s.view);
  const rawCap = useGraphStore((s) => s.rawCap);
  const initialLoadDone = useRef(false);
  const savedPositions = useRef<Map<string, [number, number, number]>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // raw view sends its cap; cluster view's cap is server-defaulted (GRAPH_CLUSTER_CAP).
        const capParam = view === 'raw' ? `&cap=${rawCap}` : '';
        const res = await fetch(`/api/graph?view=${view}&mode=${mode}${capParam}`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json: any = await res.json();
        if (cancelled) return;
        const { nodes, edges, clusters } = json.data;

        let positioned;
        if (!initialLoadDone.current) {
          // 첫 로드: 랜덤 위치 (force layout이 이후 정리)
          positioned = nodes.map((n: any) => {
            const pos: [number, number, number] = [
              (Math.random() - 0.5) * 500,
              (Math.random() - 0.5) * 500,
              (Math.random() - 0.5) * 500,
            ];
            savedPositions.current.set(n.id, pos);
            return { ...n, position: pos };
          });
          initialLoadDone.current = true;
        } else {
          // 모드/뷰 전환: 기존 위치 유지, clusterId만 변경.
          positioned = nodes.map((n: any) => {
            // Cluster super-nodes carry a BAKED galaxy position from the server. The else
            // branch is the dominant path on EVERY toggle (initialLoadDone never resets), and
            // cluster:N ids were never in savedPositions → without this they'd be randomized,
            // scattering the galaxy. Use the server position verbatim, skip savedPositions.
            if (n.isCluster && n.position) return n;
            return {
              ...n,
              position: savedPositions.current.get(n.id) ?? [
                (Math.random() - 0.5) * 500,
                (Math.random() - 0.5) * 500,
                (Math.random() - 0.5) * 500,
              ],
            };
          });
        }

        setGraphData(positioned, edges, clusters);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [mode, view, rawCap, setGraphData, setLoading, setError]);

  // force layout이 위치를 업데이트할 때마다 저장
  const nodes = useGraphStore((s) => s.nodes);
  useEffect(() => {
    for (const n of nodes) {
      if (n.position) savedPositions.current.set(n.id, n.position);
    }
  }, [nodes]);
}
