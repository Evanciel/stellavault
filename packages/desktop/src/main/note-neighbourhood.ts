// 한 노트 주변의 위키링크 이웃 — 그래프 상한과 무관하게 동작하는 로컬 서브그래프.
//
// 왜 있나: GraphView 의 "Explore in graph" 는 graph:build 결과(최근 N개로 잘린 전역
// 그래프)에서 중심 노트를 찾아 BFS 했다. 실볼트 17,462개 중 그래프에 실리는 건 3,000개라
// 오래된 노트를 열면 중심을 못 찾아 아무것도 로드하지 않았고, 화면에는 "아직 색인된 문서가
// 없습니다"가 떴다 — 색인은 멀쩡한데. (실측: 이 노트보다 최근인 문서가 16,232개.)
//
// ★링크는 DB 에 **해석되지 않은 상태**로 저장된다(links.target_norm = 링크에 쓴 문자열).
//   문자열 → 문서 해석은 store.getLinkPairs() 가 5단 사다리로 처리한다. 그래서 이 모듈은
//   SQL 을 직접 쓰지 않고 **이미 해석된 쌍**을 받는다. 처음엔 links 에 target_doc_id 컬럼이
//   있다고 가정하고 SQL 을 썼는데 그런 컬럼은 없다 — 가짜 DB 로 만든 테스트는 SQL 을 검증하지
//   않으므로 전부 통과했고, 실제 앱에서만 조용히 빈 결과가 나왔다.

/** store.getLinkPairs() 가 돌려주는 해석된 링크 한 건. */
export interface ResolvedPair {
  sourceDocId: string;
  targetDocId: string;
}

export interface NeighbourEdge {
  source: string;
  target: string;
  weight: number;
  kind: 'link';
}

export interface LinkHops {
  /** 중심에서 각 문서까지의 홉 수. 중심은 0. */
  hops: Map<string, number>;
  edges: NeighbourEdge[];
  /** maxNodes 에 걸려 넓히지 못한 이웃 수. 0 이면 전량이다. */
  truncated: number;
}

/**
 * 해석된 링크 쌍 위에서 중심 문서로부터 `depth` 홉 안쪽을 넓힌다.
 *
 * 방향은 무시한다(양방향 확장). 백링크를 빼면 "주변"의 절반만 보이는데, 사용자가 기대하는
 * 것은 "이 노트와 연결된 것 전부"다.
 */
export function linkHops(
  pairs: readonly ResolvedPair[],
  centerId: string,
  depth = 2,
  maxNodes = 400,
): LinkHops {
  const d = Math.max(1, Math.min(3, Math.round(depth)));
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;                       // 자기 자신으로 가는 링크는 선이 아니다
    let s = adj.get(a);
    if (!s) { s = new Set(); adj.set(a, s); }
    s.add(b);
  };
  for (const p of pairs) { link(p.sourceDocId, p.targetDocId); link(p.targetDocId, p.sourceDocId); }

  const hops = new Map<string, number>([[centerId, 0]]);
  let frontier = [centerId];
  let truncated = 0;
  for (let h = 1; h <= d && frontier.length > 0; h++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (hops.has(nb)) continue;
        // 상한을 넘으면 더 넓히지 않는다 — 허브 하나가 화면을 터뜨리는 것을 막는다.
        if (hops.size >= maxNodes) { truncated++; continue; }
        hops.set(nb, h);
        next.push(nb);
      }
    }
    frontier = next;
  }

  const seen = new Set<string>();
  const edges: NeighbourEdge[] = [];
  for (const p of pairs) {
    if (!hops.has(p.sourceDocId) || !hops.has(p.targetDocId)) continue;
    if (p.sourceDocId === p.targetDocId) continue;
    // 양방향 링크를 선 두 개로 긋지 않는다.
    const key = p.sourceDocId < p.targetDocId
      ? `${p.sourceDocId}:${p.targetDocId}`
      : `${p.targetDocId}:${p.sourceDocId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: p.sourceDocId, target: p.targetDocId, weight: 1, kind: 'link' });
  }

  return { hops, edges, truncated };
}

export interface NeighbourNode {
  id: string;
  title: string;
  filePath: string;
  /** 중심에서 몇 홉 — 렌더러가 크기/색을 정할 때 쓴다. */
  hop: number;
}

export interface NoteNeighbourhood {
  /** 중심 노트를 색인에서 찾았는가. false 면 진짜로 색인에 없는 문서다. */
  found: boolean;
  /** 색인에는 있는데 링크가 하나도 없는 경우 — 고장이 아니라 고립된 노트다. */
  isolated: boolean;
  nodes: NeighbourNode[];
  edges: NeighbourEdge[];
  truncated: number;
}

/** 홉 결과에 제목/경로를 붙여 렌더러가 쓸 모양으로 만든다. 중심이 항상 0번이다. */
export function buildNeighbourhood(
  hopResult: LinkHops,
  centerId: string,
  meta: Map<string, { title?: string; filePath?: string }>,
): NoteNeighbourhood {
  const nodes: NeighbourNode[] = [...hopResult.hops.entries()]
    .filter(([id]) => meta.has(id))
    .map(([id, hop]) => {
      const m = meta.get(id)!;
      return {
        id,
        title: m.title || (m.filePath ?? '').split('/').pop()?.replace(/\.md$/, '') || id,
        filePath: m.filePath ?? '',
        hop,
      };
    })
    // 중심이 0번이어야 한다 — 렌더러의 레이아웃/포커스가 첫 노드를 기준으로 잡는다.
    .sort((a, b) => a.hop - b.hop || (a.id === centerId ? -1 : b.id === centerId ? 1 : 0));

  const present = new Set(nodes.map((n) => n.id));
  return {
    found: meta.has(centerId),
    isolated: nodes.length <= 1,
    nodes,
    edges: hopResult.edges.filter((e) => present.has(e.source) && present.has(e.target)),
    truncated: hopResult.truncated,
  };
}
