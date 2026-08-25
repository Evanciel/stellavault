import { describe, it, expect } from 'vitest';
import { linkHops, buildNeighbourhood, type ResolvedPair } from '../src/main/note-neighbourhood.js';

const pair = (s: string, t: string): ResolvedPair => ({ sourceDocId: s, targetDocId: t });
const meta = (...ids: string[]) =>
  new Map(ids.map((id) => [id, { title: id.toUpperCase(), filePath: `${id}.md` }]));

//  a → b → c → d      e (고립)
const LINKS = [pair('a', 'b'), pair('b', 'c'), pair('c', 'd')];
const META = meta('a', 'b', 'c', 'd', 'e');

describe('링크 홉 확장', () => {
  it('1홉은 직접 이웃까지', () => {
    expect([...linkHops(LINKS, 'a', 1).hops.keys()].sort()).toEqual(['a', 'b']);
  });

  it('2홉은 이웃의 이웃까지', () => {
    const r = linkHops(LINKS, 'a', 2);
    expect([...r.hops.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(r.hops.get('c')).toBe(2);
  });

  // 백링크를 빼면 "주변"의 절반만 보인다 — 사용자는 링크 방향을 의식하지 않는다.
  it('링크 방향과 무관하게 퍼진다', () => {
    expect([...linkHops([pair('c', 'b')], 'b', 1).hops.keys()].sort()).toEqual(['b', 'c']);
  });

  it('연결되지 않은 문서는 절대 들어오지 않는다', () => {
    expect(linkHops(LINKS, 'a', 3).hops.has('e')).toBe(false);
  });

  it('양방향 링크를 선 두 개로 긋지 않는다', () => {
    expect(linkHops([pair('a', 'b'), pair('b', 'a')], 'a', 1).edges.length).toBe(1);
  });

  it('자기 자신으로 가는 링크는 버린다', () => {
    const r = linkHops([pair('a', 'a'), pair('a', 'b')], 'a', 1);
    expect(r.edges.every((e) => e.source !== e.target)).toBe(true);
    expect(r.hops.size).toBe(2);
  });

  it('엣지는 전부 link 계층 — 추론이 아니라 사용자가 쓴 것이다', () => {
    expect(linkHops(LINKS, 'a', 2).edges.every((e) => e.kind === 'link' && e.weight === 1)).toBe(true);
  });

  it('maxNodes 로 허브 폭발을 막고 잘린 사실을 보고한다', () => {
    const hub = Array.from({ length: 100 }, (_, i) => pair('hub', `n${i}`));
    const r = linkHops(hub, 'hub', 1, 10);
    expect(r.hops.size).toBeLessThanOrEqual(10);
    expect(r.truncated).toBeGreaterThan(0);
  });

  it('사이클이 있어도 끝난다', () => {
    expect(linkHops([pair('a', 'b'), pair('b', 'c'), pair('c', 'a')], 'a', 3).hops.size).toBe(3);
  });

  it('depth 는 1~3 으로 잠긴다', () => {
    expect(linkHops(LINKS, 'a', 0).hops.size).toBe(2);    // 1홉으로 올림
    expect(linkHops(LINKS, 'a', 99).hops.size).toBe(4);   // 3홉으로 내림
  });
});

describe('이웃 결과 조립', () => {
  it('중심이 0번이다 — 렌더러가 첫 노드를 기준으로 잡는다', () => {
    const r = buildNeighbourhood(linkHops(LINKS, 'c', 2), 'c', META);
    expect(r.nodes[0].id).toBe('c');
    expect(r.nodes.map((n) => n.hop)).toEqual([...r.nodes.map((n) => n.hop)].sort((x, y) => x - y));
  });

  // ★이 두 케이스를 구분하지 못해서 "아직 색인된 문서가 없습니다"라는 거짓말이 나왔다.
  it('색인에 없는 문서 → found:false', () => {
    const r = buildNeighbourhood(linkHops(LINKS, 'nope', 2), 'nope', META);
    expect(r).toMatchObject({ found: false });
    expect(r.nodes).toEqual([]);
  });

  it('색인에 있지만 링크가 없는 문서 → found:true + isolated:true', () => {
    const r = buildNeighbourhood(linkHops(LINKS, 'e', 2), 'e', META);
    expect(r).toMatchObject({ found: true, isolated: true });
    expect(r.nodes.map((n) => n.id)).toEqual(['e']);
  });

  // 링크가 가리키는 문서가 색인에서 사라졌을 수 있다 — 끝점 없는 선을 남기면 안 된다.
  it('메타가 없는 노드는 빼고, 그 노드에 걸린 엣지도 같이 뺀다', () => {
    const r = buildNeighbourhood(linkHops(LINKS, 'a', 2), 'a', meta('a', 'b'));
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(r.edges.every((e) => ['a', 'b'].includes(e.source) && ['a', 'b'].includes(e.target))).toBe(true);
  });

  it('제목이 없으면 파일명에서 만든다 (라벨이 id 해시로 남지 않게)', () => {
    const m = new Map([['x', { filePath: 'notes/제목없음.md' }]]);
    const r = buildNeighbourhood(linkHops([], 'x', 1), 'x', m);
    expect(r.nodes[0].title).toBe('제목없음');
  });
});
