// 그래프 데이터 로딩 — mode 전환 시 위치 유지, 색상만 변경

import { useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

export function useGraph() {
  const { setGraphData, setLoading, setError, setBuildProgress } = useGraphStore();
  const mode = useGraphStore((s) => s.mode);
  const view = useGraphStore((s) => s.view);
  const rawCap = useGraphStore((s) => s.rawCap);
  const galaxyNonce = useGraphStore((s) => s.galaxyNonce);
  const initialLoadDone = useRef(false);
  const savedPositions = useRef<Map<string, [number, number, number]>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      // 서버가 빌드 중이면 진행률을 폴링한다. /api/graph 는 빌드가 끝나야 응답하므로, 그 사이
      // 상태는 이 별도 엔드포인트로만 볼 수 있다. 폴링은 fetch 가 끝나면 finally 에서 멈춘다.
      const poll = setInterval(() => {
        fetch('/api/graph/status')
          .then((r) => (r.ok ? r.json() : null))
          .then((st: any) => {
            if (cancelled || !st?.building) return;
            setBuildProgress({ phase: String(st.phase ?? ''), done: Number(st.done ?? 0), total: Number(st.total ?? 0) });
          })
          .catch(() => { /* 진행률은 부가정보 — 실패해도 본 요청에 영향 없다 */ });
      }, 700);
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
          // 첫 로드: 랜덤 위치 (force layout이 이후 정리) — 단, 클러스터 슈퍼노드는 서버가 구운
          // 갤럭시 위치를 그대로 쓴다(랜덤이면 첫 페인트가 흩어지고 maxR이 reload와 달라져 카메라
          // fit이 들쭉날쭉해진다 — else 분기와 동일 규칙).
          positioned = nodes.map((n: any) => {
            if (n.isCluster && n.position) return n;
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
        clearInterval(poll);
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [mode, view, rawCap, galaxyNonce, setGraphData, setLoading, setError]);

  // force layout이 위치를 업데이트할 때마다 저장
  const nodes = useGraphStore((s) => s.nodes);
  useEffect(() => {
    for (const n of nodes) {
      if (n.position) savedPositions.current.set(n.id, n.position);
    }
  }, [nodes]);
}
