import { describe, it, expect } from 'vitest';
import { partitionEdges, edgeDrawRange, buildEdgeColors } from '../src/renderer/components/graph/graph-edges-core.js';
import type { GraphNode, GraphEdge } from '../src/renderer/components/graph/graph-core.js';

const node = (id: string): GraphNode => ({
  id, title: id, filePath: `${id}.md`, cluster: 0, size: 1, position: [0, 0, 0],
});
const edge = (source: string, target: string, kind?: 'link' | 'semantic'): GraphEdge => ({
  source, target, weight: 0.5, ...(kind ? { kind } : {}),
});

const nodes = ['a', 'b', 'c', 'd'].map(node);

describe('엣지 파티션', () => {
  it('링크가 앞, 시맨틱이 뒤 — 이 순서가 필터를 두 숫자로 만든다', () => {
    const r = partitionEdges(nodes, [
      edge('a', 'b'), edge('b', 'c', 'link'), edge('c', 'd'), edge('a', 'd', 'link'),
    ]);
    expect(r.linkCount).toBe(2);
    // 앞 2개가 링크(b-c, a-d), 뒤 2개가 시맨틱
    expect(r.pairs.slice(0, 2)).toEqual([[1, 2], [0, 3]]);
  });

  it('kind 없음 = semantic — 링크 엣지가 생기기 전 payload 가 그대로 유효해야 한다', () => {
    expect(partitionEdges(nodes, [edge('a', 'b')]).linkCount).toBe(0);
  });

  it('노드 집합에 없는 끝점은 버린다', () => {
    expect(partitionEdges(nodes, [edge('a', 'zzz', 'link')]).pairs).toEqual([]);
  });

  it('자기 자신으로 가는 엣지는 버린다 (길이 0 세그먼트)', () => {
    expect(partitionEdges(nodes, [edge('a', 'a', 'link')]).pairs).toEqual([]);
  });
});

describe('drawRange', () => {
  it('both = 전량', () => expect(edgeDrawRange('both', 2, 10)).toEqual([0, 20]));
  it('links = 앞쪽 링크 구간만', () => expect(edgeDrawRange('links', 2, 10)).toEqual([0, 4]));
  it('semantic = 링크 뒤부터 끝까지', () => expect(edgeDrawRange('semantic', 2, 10)).toEqual([4, 16]));

  it('링크가 0개면 links 는 아무것도 안 그리고 semantic 은 전량이다', () => {
    expect(edgeDrawRange('links', 0, 10)).toEqual([0, 0]);
    expect(edgeDrawRange('semantic', 0, 10)).toEqual([0, 20]);
  });

  it('전부 링크면 semantic 은 빈 구간 — 음수 count 로 새지 않는다', () => {
    const [start, count] = edgeDrawRange('semantic', 10, 10);
    expect(start).toBe(20);
    expect(count).toBe(0);
  });
});

describe('정점 컬러 버퍼', () => {
  it('세그먼트당 RGBA 2개 = 8 float', () => {
    expect(buildEdgeColors(3, 1).length).toBe(24);
  });

  // 이 구분이 기능의 전부다: "내가 그은 것"이 "모델이 그럴 것 같다고 한 것"과
  // 같아 보이면 두 계층 렌더링을 할 이유가 없다.
  it('링크가 시맨틱보다 확실히 밝다 — 헤이즈가 겹쳐도 위로 올라오게', () => {
    const c = buildEdgeColors(2, 1);
    const linkAlpha = c[7];        // 0번 슬롯(링크) target 쪽 알파
    const semanticAlpha = c[15];   // 1번 슬롯(시맨틱) target 쪽 알파
    expect(linkAlpha).toBeGreaterThan(semanticAlpha * 3);
  });

  it('링크는 source 쪽이 옅다 — 방향 테이퍼 (시맨틱은 무방향이라 평평)', () => {
    const c = buildEdgeColors(2, 1);
    expect(c[3]).toBeLessThan(c[7]);      // 링크: source < target
    expect(c[11]).toBe(c[15]);            // 시맨틱: 양끝 동일
  });

  it('링크와 시맨틱은 색상 채널로도 분리된다 (가산 누적 위에서 읽히도록)', () => {
    const c = buildEdgeColors(2, 1);
    const link = [c[0], c[1], c[2]];
    const semantic = [c[8], c[9], c[10]];
    // 앰버 vs 스틸블루 — R 채널이 뒤집힌다
    expect(link[0]).toBeGreaterThan(semantic[0]);
    expect(link[2]).toBeLessThan(semantic[2]);
  });

  it('링크가 0개면 전부 시맨틱 색이다', () => {
    const c = buildEdgeColors(2, 0);
    expect([c[0], c[1], c[2]]).toEqual([c[8], c[9], c[10]]);
  });
});
