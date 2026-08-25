import { describe, it, expect } from 'vitest';
import {
  localSubgraph, nextSegment, folderLevel, folderScene, tagOverlay, commonPathPrefix,
  type SceneNode, type SceneEdge,
} from '../src/lib/scene-derive.js';

function node(id: string, filePath = `${id}.md`, tags: string[] = []): SceneNode {
  return { id, label: id, filePath, tags, clusterId: 0, size: 1 };
}
function edge(source: string, target: string, weight = 0.5, kind?: 'link' | 'semantic'): SceneEdge {
  return { source, target, weight, ...(kind ? { kind } : {}) };
}

describe('로컬 그래프 (N-hop)', () => {
  //   a — b — c — d        e (고립)
  //   |
  //   f
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id));
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'f')];

  it('1홉은 직접 이웃까지만', () => {
    const r = localSubgraph(nodes, edges, 'a', 1);
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'f']);
    expect(r.hops.get('b')).toBe(1);
  });

  it('2홉은 이웃의 이웃까지', () => {
    const r = localSubgraph(nodes, edges, 'a', 2);
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'f']);
    expect(r.hops.get('c')).toBe(2);
  });

  it('엣지 방향과 무관하게 퍼진다 — 백링크를 빼면 "주변"의 절반만 보인다', () => {
    // c→b 방향만 있는 링크. b 에서 출발해도 c 가 잡혀야 한다.
    const r = localSubgraph(nodes, [edge('c', 'b', 1, 'link')], 'b', 1);
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['b', 'c']);
  });

  it('부분집합 안쪽 엣지만 남긴다 (한쪽 끝이 잘린 엣지는 버린다)', () => {
    const r = localSubgraph(nodes, edges, 'a', 1);
    expect(r.edges.map((e) => `${e.source}-${e.target}`).sort()).toEqual(['a-b', 'a-f']);
  });

  it('연결되지 않은 노드는 절대 들어오지 않는다', () => {
    const r = localSubgraph(nodes, edges, 'a', 4);
    expect(r.nodes.some((n) => n.id === 'e')).toBe(false);
  });

  it('루트가 0번 — 홉 오름차순 정렬', () => {
    const r = localSubgraph(nodes, edges, 'c', 2);
    expect(r.nodes[0].id).toBe('c');
    expect(r.hops.get(r.nodes[r.nodes.length - 1].id)).toBe(2);
  });

  it('없는 루트는 빈 결과 (throw 하지 않는다)', () => {
    expect(localSubgraph(nodes, edges, 'nope', 2).nodes).toEqual([]);
  });

  it('maxNodes 로 허브 폭발을 막고, 잘린 사실을 보고한다', () => {
    // 허브 하나에 100개가 붙은 경우 — 1홉인데도 화면이 터진다.
    const hubNodes = [node('hub'), ...Array.from({ length: 100 }, (_, i) => node(`n${i}`))];
    const hubEdges = Array.from({ length: 100 }, (_, i) => edge('hub', `n${i}`));
    const r = localSubgraph(hubNodes, hubEdges, 'hub', 1, { maxNodes: 10 });
    expect(r.nodes.length).toBe(10);
    expect(r.truncated).toBeGreaterThan(0);
  });

  it('사이클이 있어도 끝난다', () => {
    const cyc = ['x', 'y', 'z'].map((id) => node(id));
    const r = localSubgraph(cyc, [edge('x', 'y'), edge('y', 'z'), edge('z', 'x')], 'x', 9);
    expect(r.nodes.length).toBe(3);
  });
});

describe('폴더 계층', () => {
  it('nextSegment — 루트 레벨', () => {
    expect(nextSegment('00_Inbox/feeds/a.md', '')).toBe('00_Inbox');
    expect(nextSegment('README.md', '')).toBeNull();          // 이 레벨의 파일
  });

  it('nextSegment — 접두사 아래 한 칸', () => {
    expect(nextSegment('00_Inbox/feeds/a.md', '00_Inbox')).toBe('feeds');
    expect(nextSegment('00_Inbox/a.md', '00_Inbox')).toBeNull();
    expect(nextSegment('other/a.md', '00_Inbox')).toBeNull(); // 접두사 밖
  });

  it('nextSegment 는 접두사 경계를 지킨다 — 00_Inbox 가 00_InboxOld 를 먹지 않는다', () => {
    expect(nextSegment('00_InboxOld/x/a.md', '00_Inbox')).toBeNull();
  });

  it('한 계단만 펼친다 — 손자 폴더로 재귀하지 않는다', () => {
    const members = [
      node('a', '08_Patterns/concepts/deep/a.md'),
      node('b', '08_Patterns/concepts/b.md'),
      node('c', '08_Patterns/loose.md'),
    ];
    const lv = folderLevel(members, '08_Patterns');
    expect(lv.folders.map((f) => f.name)).toEqual(['concepts']);
    expect(lv.folders[0].count).toBe(2);        // deep/a.md 도 concepts 밑이다
    expect(lv.loose.map((n) => n.id)).toEqual(['c']);
  });

  it('큰 폴더가 먼저 온다', () => {
    const members = [
      node('a', 'p/small/a.md'),
      node('b', 'p/big/b.md'), node('c', 'p/big/c.md'), node('d', 'p/big/d.md'),
    ];
    expect(folderLevel(members, 'p').folders.map((f) => f.name)).toEqual(['big', 'small']);
  });

  it('folderScene — 하위 폴더는 슈퍼노드로 접히고 이 레벨 파일은 그대로', () => {
    const members = [
      node('a', 'p/sub/a.md'), node('b', 'p/sub/b.md'), node('c', 'p/loose.md'),
    ];
    const scene = folderScene(folderLevel(members, 'p'), []);
    const ids = scene.nodes.map((n) => n.id);
    expect(ids).toContain('folder:p/sub');
    expect(ids).toContain('c');
    expect(scene.nodes.find((n) => n.id === 'folder:p/sub')!.memberCount).toBe(2);
  });

  it('folderScene — 파일이 0번이다 (레이아웃 스킵 함정 방지)', () => {
    const members = [node('a', 'p/sub/a.md'), node('c', 'p/loose.md')];
    const scene = folderScene(folderLevel(members, 'p'), []);
    expect(scene.nodes[0].isCluster).toBeFalsy();
  });

  it('folderScene — 그룹 안쪽 엣지는 버리고 그룹 간 엣지는 합친다', () => {
    const members = [node('a', 'p/sub/a.md'), node('b', 'p/sub/b.md'), node('c', 'p/loose.md')];
    const scene = folderScene(folderLevel(members, 'p'), [
      edge('a', 'b', 0.9),   // sub 안쪽 — 접힌 노드를 열어야 보이는 연결
      edge('a', 'c', 0.4),
      edge('b', 'c', 0.6),   // 위와 같은 (sub ↔ c) 다발
    ]);
    expect(scene.edges.length).toBe(1);
    expect(scene.edges[0].weight).toBeCloseTo(1.0);
  });

  it('folderScene — 다발에 손으로 그은 링크가 하나라도 있으면 링크로 승격', () => {
    const members = [node('a', 'p/sub/a.md'), node('c', 'p/loose.md')];
    const scene = folderScene(folderLevel(members, 'p'), [
      edge('a', 'c', 0.4),
      edge('c', 'a', 1, 'link'),
    ]);
    expect(scene.edges[0].kind).toBe('link');
  });

  it('commonPathPrefix — 한 폴더에서 온 멤버', () => {
    expect(commonPathPrefix([
      node('a', '08_Patterns/concepts/a.md'),
      node('b', '08_Patterns/concepts/deep/b.md'),
    ])).toBe('08_Patterns/concepts');
  });

  it('commonPathPrefix — 여러 최상위에서 온 멤버는 빈 접두사 ((other) 클러스터의 모양)', () => {
    expect(commonPathPrefix([
      node('a', '08_Patterns/a.md'),
      node('b', '00_Inbox/b.md'),
    ])).toBe('');
  });

  it('commonPathPrefix — 루트 파일이 섞이면 빈 접두사', () => {
    expect(commonPathPrefix([node('a', 'README.md'), node('b', 'docs/b.md')])).toBe('');
  });

  it('실볼트 모양 — 08_Patterns 8,109개 중 8,098개가 concepts 한 폴더', () => {
    const members = [
      ...Array.from({ length: 8098 }, (_, i) => node(`c${i}`, `08_Patterns/concepts/c${i}.md`)),
      ...Array.from({ length: 11 }, (_, i) => node(`l${i}`, `08_Patterns/l${i}.md`)),
    ];
    const lv = folderLevel(members, '08_Patterns');
    expect(lv.folders[0]).toMatchObject({ name: 'concepts', count: 8098 });
    // 8,109개 덩어리가 슈퍼노드 1개 + 파일 11개로 줄어든다 — 드릴다운이 의미를 갖는 지점.
    expect(folderScene(lv, []).nodes.length).toBe(12);
  });
});

describe('태그 오버레이', () => {
  it('노트 하나만 쓰는 태그는 제외하고, 몇 개를 걸렀는지 보고한다', () => {
    // 이 볼트의 실제 모양이다: 17,339개 중 26개만 태그가 있고 공유 태그는 8개뿐.
    const nodes = [
      node('a', 'a.md', ['solo']),
      node('b', 'b.md', ['shared']),
      node('c', 'c.md', ['shared']),
    ];
    const r = tagOverlay(nodes);
    expect(r.tagCount).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.nodes[0].id).toBe('tag:shared');
  });

  it('태그가 하나도 없으면 빈 결과 — 고장이 아니라 데이터가 없는 것', () => {
    const r = tagOverlay([node('a'), node('b')]);
    expect(r).toMatchObject({ tagCount: 0, skipped: 0 });
    expect(r.edges).toEqual([]);
  });

  it('태그 엣지는 link 계층이다 — 사용자가 손으로 붙인 것이라 추론이 아니다', () => {
    const r = tagOverlay([node('a', 'a.md', ['t']), node('b', 'b.md', ['t'])]);
    expect(r.edges.every((e) => e.kind === 'link')).toBe(true);
    expect(r.edges.length).toBe(2);
  });

  it('maxTags 로 상한을 두고 많이 쓰인 태그를 먼저 남긴다', () => {
    const nodes = [
      node('a', 'a.md', ['rare', 'common']), node('b', 'b.md', ['rare', 'common']),
      node('c', 'c.md', ['common']),
    ];
    const r = tagOverlay(nodes, { maxTags: 1 });
    expect(r.nodes.map((n) => n.label)).toEqual(['#common']);
  });

  it('공백 태그와 빈 문자열은 무시한다', () => {
    const r = tagOverlay([node('a', 'a.md', ['  ', '']), node('b', 'b.md', ['  ', ''])]);
    expect(r.tagCount).toBe(0);
  });
});
