// 이미 로드된 노드/엣지 집합에서 파생 씬을 만드는 순수 함수들.
//
// 로컬 그래프 · 폴더 하위 드릴다운 · 태그 노드는 전부 서버 왕복 없이 클라이언트에서 만들 수 있다.
// (a) 로컬 그래프 = 엣지 그래프 위의 N-hop BFS, (b) 폴더 계층 = filePath 문자열 쪼개기,
// (c) 태그 = node.tags 역색인. 셋 다 서버가 이미 보낸 것 이상을 필요로 하지 않는다.
//
// React 밖 순수 함수로 빼둔 이유는 테스트 때문이다 — 이 패키지에는 렌더러 테스트 러너가 없어서,
// 로직이 컴포넌트 안에 있으면 검증할 방법이 브라우저 눈대중뿐이다.

export interface SceneNode {
  id: string;
  label: string;
  filePath: string;
  tags: string[];
  clusterId: number;
  size: number;
  position?: [number, number, number];
  source?: string;
  type?: string;
  lastModified?: string;
  isCluster?: boolean;
  memberCount?: number;
  representativeId?: string;
}

export interface SceneEdge {
  source: string;
  target: string;
  weight: number;
  kind?: 'link' | 'semantic';
}

// ─────────────────────────────────────────────────────────────────────────────
// 로컬 그래프 — 한 노트에서 N홉
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `rootId` 에서 `depth` 홉 안에 있는 노드와 그 사이 엣지만 남긴다.
 *
 * 방향은 무시한다(무방향 BFS). 링크 엣지는 방향이 있지만, "이 노트 주변"을 볼 때 나를 가리키는
 * 백링크를 빼면 절반만 보이는 셈이라 쓸모가 없다.
 *
 * 반환 노드는 `hop` 을 clusterId 로 덮어쓰지 **않는다** — 색이 바뀌면 어느 주제 클러스터에서 온
 * 이웃인지 읽을 수 없게 된다. 홉 수는 별도로 돌려준다.
 */
export function localSubgraph(
  nodes: readonly SceneNode[],
  edges: readonly SceneEdge[],
  rootId: string,
  depth: number,
  opts: { maxNodes?: number } = {},
): { nodes: SceneNode[]; edges: SceneEdge[]; hops: Map<string, number>; truncated: number } {
  const maxNodes = opts.maxNodes ?? 600;
  const byId = new Map<string, SceneNode>();
  for (const n of nodes) byId.set(n.id, n);
  if (!byId.has(rootId)) return { nodes: [], edges: [], hops: new Map(), truncated: 0 };

  // 인접 리스트. 허브 노트 하나 때문에 매 홉마다 전체 엣지를 훑지 않도록 한 번만 만든다.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    let a = adj.get(e.source);
    if (!a) { a = []; adj.set(e.source, a); }
    a.push(e.target);
    let b = adj.get(e.target);
    if (!b) { b = []; adj.set(e.target, b); }
    b.push(e.source);
  }

  const hops = new Map<string, number>([[rootId, 0]]);
  let frontier = [rootId];
  let truncated = 0;
  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const peer of adj.get(cur) ?? []) {
        if (hops.has(peer) || !byId.has(peer)) continue;
        if (hops.size >= maxNodes) { truncated++; continue; }
        hops.set(peer, d);
        next.push(peer);
      }
    }
    frontier = next;
  }

  const keptNodes: SceneNode[] = [];
  for (const [id] of hops) {
    const n = byId.get(id);
    if (n) keptNodes.push(n);
  }
  // 루트를 0번에 둔다 — fitView 와 카메라가 첫 노드를 기준점으로 쓰는 자리가 있고,
  // 무엇보다 "이 노트의 주변" 이라는 화면에서 루트가 목록 맨 앞인 편이 자연스럽다.
  keptNodes.sort((a, b) => (hops.get(a.id)! - hops.get(b.id)!));

  const keptEdges = edges.filter((e) => hops.has(e.source) && hops.has(e.target));
  return { nodes: keptNodes, edges: keptEdges, hops, truncated };
}

// ─────────────────────────────────────────────────────────────────────────────
// 폴더 계층
// ─────────────────────────────────────────────────────────────────────────────

/** 경로에서 `prefix` 바로 다음 세그먼트. prefix 아래가 아니거나 파일 자신이면 null. */
export function nextSegment(filePath: string, prefix: string): string | null {
  const rest = prefix === '' ? filePath : (filePath.startsWith(prefix + '/') ? filePath.slice(prefix.length + 1) : null);
  if (rest === null) return null;
  const i = rest.indexOf('/');
  return i > 0 ? rest.slice(0, i) : null; // '/' 가 없으면 이 레벨의 파일이다(폴더 아님)
}

/**
 * 이 노드 집합 전체를 담는 가장 깊은 폴더 경로. 폴더 드릴다운의 시작 지점을 정한다.
 *
 * 클러스터 라벨을 접두사로 쓰지 않는 이유: 폴더 모드에는 `(other) (N)` 처럼 실제 경로가 아닌
 * 라벨이 있고(캡을 넘긴 폴더들을 접은 것), 그런 클러스터의 멤버는 여러 최상위 폴더에서 온다.
 * 멤버에서 직접 뽑으면 그 경우 공통 접두사가 '' 이 되어 최상위 폴더 목록이 나온다 — 정확히
 * 보고 싶은 그림이다.
 */
export function commonPathPrefix(members: readonly SceneNode[]): string {
  let prefix: string[] | null = null;
  for (const n of members) {
    const segs = (n.filePath ?? '').split('/');
    segs.pop(); // 파일명 제거 — 폴더 경로만 본다
    if (prefix === null) { prefix = segs; continue; }
    let i = 0;
    while (i < prefix.length && i < segs.length && prefix[i] === segs[i]) i++;
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) break;
  }
  return (prefix ?? []).join('/');
}

export interface FolderLevel {
  /** 이 레벨의 하위 폴더 — 슈퍼노드로 접힌다. */
  folders: Array<{ name: string; path: string; count: number; members: SceneNode[] }>;
  /** 이 레벨에 바로 놓인 파일(더 내려갈 폴더가 없다). */
  loose: SceneNode[];
}

/**
 * `prefix` 폴더 바로 아래를 한 단계만 펼친다. 재귀하지 않는다 — 드릴다운은 한 번에 한 계단이다.
 *
 * 실측(사용자 볼트): `08_Patterns` 8,109개 중 8,098개가 `concepts` 한 폴더에 있다. 이 계층을
 * 안 보여주면 그 클러스터에 들어갔을 때 8천 개짜리 구분 없는 덩어리만 나온다.
 */
export function folderLevel(members: readonly SceneNode[], prefix: string): FolderLevel {
  const folders = new Map<string, SceneNode[]>();
  const loose: SceneNode[] = [];
  for (const n of members) {
    const seg = nextSegment(n.filePath ?? '', prefix);
    if (seg === null) { loose.push(n); continue; }
    const list = folders.get(seg);
    if (list) list.push(n);
    else folders.set(seg, [n]);
  }
  return {
    folders: [...folders.entries()]
      .map(([name, ms]) => ({
        name,
        path: prefix === '' ? name : `${prefix}/${name}`,
        count: ms.length,
        members: ms,
      }))
      .sort((a, b) => b.count - a.count),
    loose,
  };
}

/**
 * 한 폴더 레벨을 화면에 올릴 노드/엣지로 바꾼다.
 *
 * 하위 폴더는 슈퍼노드 하나로 접고, 이 레벨의 파일은 그대로 둔다. 엣지는 원본 엣지를 "양 끝이
 * 어느 그룹에 속하는가"로 접어 만든다(같은 그룹 안쪽 엣지는 버린다 — 접힌 노드 안의 연결은
 * 그 노드를 열어야 보이는 것이다).
 */
export function folderScene(
  level: FolderLevel,
  allEdges: readonly SceneEdge[],
  paletteOffset = 0,
): { nodes: SceneNode[]; edges: SceneEdge[] } {
  const groupOf = new Map<string, string>();   // nodeId -> 그룹 id
  const nodes: SceneNode[] = [];

  // 파일이 먼저다: 이 씬은 baked 가 아니라 force 레이아웃을 타야 하는데, 예전 코드가
  // `nodes[0].isCluster` 로 레이아웃 스킵을 판정했다. 지금은 sceneBaked 플래그로 바뀌었지만
  // 순서까지 뒤집어 두면 그 함정이 되살아나도 조용히 깨지지 않는다.
  for (const n of level.loose) {
    groupOf.set(n.id, n.id);
    nodes.push(n);
  }
  level.folders.forEach((f, i) => {
    const gid = `folder:${f.path}`;
    for (const m of f.members) groupOf.set(m.id, gid);
    nodes.push({
      id: gid,
      label: f.name,
      filePath: f.path,
      tags: [],
      clusterId: paletteOffset + i,
      size: 3 + Math.min(14, Math.sqrt(f.count)),
      source: 'folder',
      type: 'folder',
      isCluster: true,
      memberCount: f.count,
      representativeId: f.members[0]?.id,
    });
  });

  const agg = new Map<string, SceneEdge>();
  for (const e of allEdges) {
    const a = groupOf.get(e.source);
    const b = groupOf.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    const cur = agg.get(key);
    if (cur) {
      cur.weight += e.weight;
      // 접힌 엣지 다발에 손으로 그은 링크가 하나라도 있으면 링크로 친다 — 사실이 추론을 덮는다.
      if (e.kind === 'link') cur.kind = 'link';
    } else {
      agg.set(key, { source: a, target: b, weight: e.weight, kind: e.kind });
    }
  }
  return { nodes, edges: [...agg.values()] };
}

// ─────────────────────────────────────────────────────────────────────────────
// 태그 노드
// ─────────────────────────────────────────────────────────────────────────────

export interface TagOverlay {
  nodes: SceneNode[];
  edges: SceneEdge[];
  /** 노드로 올린 태그 수. */
  tagCount: number;
  /** minNotes 미달로 제외된 태그 수 — UI 가 "왜 아무것도 안 뜨는지" 말해줄 수 있게. */
  skipped: number;
}

/**
 * 태그를 노드로 합성해 현재 씬에 얹는다.
 *
 * ★실측을 먼저 적어둔다(사용자 볼트 17,339 노트): 태그가 하나라도 달린 노트는 **26개(0.15%)**,
 * 서로 다른 태그 39개, 그중 2개 이상 노트가 공유하는 태그는 **8개**뿐이다(최다는 "N" 6개,
 * "bbb-" 5개 — 프론트매터 파싱 잔재로 보인다). 즉 이 오버레이는 지금 이 볼트에서는 거의 아무것도
 * 그리지 않는다. 기능이 고장난 게 아니라 데이터가 없는 것이고, UI 는 그 둘을 구분해서 말해야 한다
 * (그래서 skipped 를 같이 돌려준다).
 *
 * minNotes 기본값이 2인 이유: 노트 하나만 쓰는 태그는 그 노트에 매달린 꼬리표일 뿐 연결이 아니다.
 * 그래프에 올리면 노드 수만 늘고 구조는 하나도 안 늘어난다.
 */
export function tagOverlay(
  nodes: readonly SceneNode[],
  opts: { minNotes?: number; maxTags?: number; clusterIdBase?: number } = {},
): TagOverlay {
  const minNotes = opts.minNotes ?? 2;
  const maxTags = opts.maxTags ?? 200;
  const base = opts.clusterIdBase ?? 0;

  const byTag = new Map<string, string[]>();
  for (const n of nodes) {
    for (const raw of n.tags ?? []) {
      const tag = String(raw).trim();
      if (!tag) continue;
      const list = byTag.get(tag);
      if (list) list.push(n.id);
      else byTag.set(tag, [n.id]);
    }
  }

  const eligible = [...byTag.entries()].filter(([, ids]) => ids.length >= minNotes);
  const skipped = byTag.size - eligible.length;
  const chosen = eligible.sort((a, b) => b[1].length - a[1].length).slice(0, maxTags);

  const tagNodes: SceneNode[] = [];
  const tagEdges: SceneEdge[] = [];
  chosen.forEach(([tag, ids], i) => {
    const id = `tag:${tag}`;
    tagNodes.push({
      id,
      label: `#${tag}`,
      filePath: '',
      tags: [],
      clusterId: base + i,
      size: 2 + Math.min(10, Math.sqrt(ids.length) * 2),
      source: 'tag',
      type: 'tag',
      isCluster: false,
      memberCount: ids.length,
    });
    // 태그는 사용자가 손으로 붙인 것이라 위키링크와 같은 계층이다 — 추론이 아니라 사실.
    for (const nid of ids) tagEdges.push({ source: nid, target: id, weight: 1, kind: 'link' });
  });

  return { nodes: tagNodes, edges: tagEdges, tagCount: tagNodes.length, skipped };
}
