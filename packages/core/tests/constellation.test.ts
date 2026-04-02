import { describe, it, expect } from 'vitest';

// constellation.ts는 graph 패키지에 있으므로 MST 알고리즘 로직만 테스트
// Prim's MST: 노드를 최소 거리로 연결

function primMST(positions: Array<[number, number, number]>): Array<[number, number]> {
  const n = positions.length;
  if (n < 2) return [];

  const inMST = new Array(n).fill(false);
  const minEdge = new Array(n).fill(Infinity);
  const parent = new Array(n).fill(-1);
  minEdge[0] = 0;
  const edges: Array<[number, number]> = [];

  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inMST[i] && (u === -1 || minEdge[i] < minEdge[u])) u = i;
    }
    if (u === -1) break;
    inMST[u] = true;
    if (parent[u] !== -1) edges.push([parent[u], u]);

    for (let v = 0; v < n; v++) {
      if (inMST[v]) continue;
      const d = Math.sqrt(
        (positions[u][0] - positions[v][0]) ** 2 +
        (positions[u][1] - positions[v][1]) ** 2 +
        (positions[u][2] - positions[v][2]) ** 2
      );
      if (d < minEdge[v]) { minEdge[v] = d; parent[v] = u; }
    }
  }
  return edges;
}

describe('Constellation MST', () => {
  it('2개 노드 → 1개 엣지', () => {
    const edges = primMST([[0, 0, 0], [10, 0, 0]]);
    expect(edges.length).toBe(1);
  });

  it('3개 노드 → 2개 엣지', () => {
    const edges = primMST([[0, 0, 0], [10, 0, 0], [5, 10, 0]]);
    expect(edges.length).toBe(2);
  });

  it('1개 노드 → 엣지 없음', () => {
    const edges = primMST([[0, 0, 0]]);
    expect(edges.length).toBe(0);
  });

  it('빈 배열 → 엣지 없음', () => {
    const edges = primMST([]);
    expect(edges.length).toBe(0);
  });

  it('MST는 N-1개 엣지 (트리)', () => {
    const positions: Array<[number, number, number]> = [];
    for (let i = 0; i < 10; i++) positions.push([i * 10, Math.random() * 10, 0]);
    const edges = primMST(positions);
    expect(edges.length).toBe(9);
  });

  it('모든 노드가 연결됨', () => {
    const positions: Array<[number, number, number]> = [[0, 0, 0], [100, 0, 0], [50, 100, 0], [50, 50, 50]];
    const edges = primMST(positions);
    const connected = new Set<number>();
    connected.add(0);
    for (const [a, b] of edges) {
      connected.add(a);
      connected.add(b);
    }
    expect(connected.size).toBe(4);
  });
});
