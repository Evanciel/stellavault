// 엣지 2계층의 순수 로직 — 파티션 · drawRange · 정점 컬러 버퍼.
//
// graph-core.tsx 에서 분리한 이유: 그 파일은 모듈 로드 시점에 canvas 로 텍스처를 굽기
// 때문에(circleTexture) DOM 없는 환경에서 import 자체가 실패한다. 여기 있는 것들은
// THREE.Color 말고는 아무것도 필요 없어서 그대로 테스트할 수 있다.

import * as THREE from 'three';
import type { GraphNode, GraphEdge } from './graph-core.js';

/** 엣지 필터 — 버퍼가 link-먼저로 정렬돼 있어 전환은 setDrawRange 두 숫자다. */
export type EdgeFilter = 'both' | 'links' | 'semantic';

/**
 * 엣지를 인덱스 쌍으로 바꾸되 **링크를 앞쪽에 모아** 정렬한다.
 *
 * 정렬해 두면 "링크만 보기"가 geometry.setDrawRange(0, linkCount*2) 두 숫자로 끝난다 —
 * 필터를 바꿀 때마다 버퍼를 다시 만들 필요가 없다. 웹 그래프(@stellavault/graph
 * GraphEdges.tsx)와 같은 배치다.
 */
export function partitionEdges(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { pairs: Array<[number, number]>; linkCount: number } {
  const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const links: Array<[number, number]> = [];
  const semantic: Array<[number, number]> = [];
  for (const e of edges) {
    const a = idToIndex.get(e.source);
    const b = idToIndex.get(e.target);
    if (a == null || b == null || a === b) continue;
    (e.kind === 'link' ? links : semantic).push([a, b]);
  }
  return { pairs: [...links, ...semantic], linkCount: links.length };
}

/** 필터 → [start, count] (정점 단위). 버퍼가 link-먼저라 잘라내기만 하면 된다. */
export function edgeDrawRange(
  filter: EdgeFilter,
  linkCount: number,
  total: number,
): [number, number] {
  if (filter === 'links') return [0, linkCount * 2];
  if (filter === 'semantic') return [linkCount * 2, (total - linkCount) * 2];
  return [0, total * 2];
}

// 앰버 vs 스틸블루. 가산 블렌딩이라 겹치는 시맨틱 엣지가 블루-화이트로 누적되는데,
// 앰버는 R/G 채널로 분리되므로 그 누적 위에서도 다른 색으로 읽힌다.
// 웹 그래프의 EDGE_HEX.dark 와 같은 값이다(데스크탑 그래프는 항상 어두운 배경).
// hex → working(linear) 변환은 THREE.Color 에 맡긴다. 손으로 적어 두면
// ColorManagement 설정이 바뀔 때 조용히 틀린 색이 된다(실제로 처음 적은 값이 어긋났다).
const EDGE_HEX = { semantic: '#4466aa', link: '#ffb454' } as const;
const EDGE_RGB = {
  semantic: (() => { const c = new THREE.Color(EDGE_HEX.semantic); return [c.r, c.g, c.b] as const; })(),
  link: (() => { const c = new THREE.Color(EDGE_HEX.link); return [c.r, c.g, c.b] as const; })(),
};
// 링크는 소수라 가산 누적이 없다. 0.50 은 시맨틱 헤이즈(0.16)의 3배 이상이라
// 헤이즈가 여러 겹 쌓여도 링크가 그 위로 올라온다.
const LINK_ALPHA = 0.5;
const SEMANTIC_ALPHA = 0.16;   // 리라이트 이전의 균일 material.opacity 와 동일
// 방향 단서는 공짜다: 세그먼트가 이미 정점 2개를 갖고 있으므로 source 쪽 알파만
// 낮추면 target 쪽으로 짙어지는 테이퍼가 된다. 시맨틱은 무방향이라 평평하게 둔다.
const LINK_TAPER = 0.22;

/**
 * 정점 RGBA 컬러 버퍼. itemSize 4 라 three 가 USE_COLOR_ALPHA 를 켜고,
 * 최종 알파 = material.opacity(=1) * vColor.a 가 된다.
 */
export function buildEdgeColors(total: number, linkCount: number): Float32Array {
  const colors = new Float32Array(total * 8);
  for (let k = 0; k < total; k++) {
    const isLink = k < linkCount;
    const rgb = isLink ? EDGE_RGB.link : EDGE_RGB.semantic;
    const a = isLink ? LINK_ALPHA : SEMANTIC_ALPHA;
    const o = k * 8;
    colors[o] = rgb[0]; colors[o + 1] = rgb[1]; colors[o + 2] = rgb[2];
    colors[o + 3] = isLink ? a * LINK_TAPER : a;
    colors[o + 4] = rgb[0]; colors[o + 5] = rgb[1]; colors[o + 6] = rgb[2];
    colors[o + 7] = a;
  }
  return colors;
}

