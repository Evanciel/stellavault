// 시냅스 엣지 — 링크/시맨틱 두 계층을 draw call 하나로 그린다.
//
// 왜 다시 썼는가 (실측):
//   - 이전 구현은 litPos/dimPos 두 개의 number[] 를 하나의 useMemo 안에서 새로 만들었고, 그 deps 에
//     activeId/highlightedNodeIds 가 들어 있었다. R3F 의 hover 키에는 event.index 가 포함되고
//     GraphNodes 의 onPointerOver 는 point index 마다 발화하므로, 노드 위를 스치는 동안 memo 가
//     계속 재실행됐다 — 엣지 70,398개 기준 재빌드 1회 중앙값 32.8ms (프레임 약 2개 손실).
//   - layout.worker 는 200 iteration 중 20마다 progress 를 보내고 useLayout 은 그때마다 새 nodes
//     배열을 만든다 → 레이아웃이 안정될 때까지 같은 재빌드가 11번, 약 360ms 블로킹.
//   - frustumCulled 기본값 탓에 three 가 새 geometry 마다 정점 140,796개 위로
//     computeBoundingSphere() 를 돌렸다. 항상 프러스텀과 교차하는 hairball 이라 컬링 이득은 0.
//
// 지금 구조 (비싼 일이 hover 에 의존하지 않도록 memo 를 쪼갰다):
//   (A) 정렬 + 인접맵            deps [edges]            — 엣지 집합이 바뀔 때만
//   (B) geometry 1회 할당,       deps [ordered], [nodes] — 레이아웃 tick 은 position 을 제자리 갱신
//       position 은 in-place 리필                          (재빌드 11번 → in-place 리필 11번)
//   (C) 색상: 테마 / hasInteraction 불리언이 뒤집힐 때만 전체 repaint,
//       hover·select 는 그 노드의 엣지만 O(degree) 부분 repaint
//
// itemSize 4 (RGBA) 정점 컬러를 쓴다. three 0.170 의 vertexAlphas 게이트
// (vertexColors === true && color.itemSize === 4) 가 USE_COLOR_ALPHA 를 켜고 color_fragment 가
// diffuseColor *= vColor 를 수행하므로, draw call 하나로 엣지별 색 + 엣지별 알파가 나온다.
// 링크 엣지를 버퍼 앞쪽에 몰아 두었으므로 3-way 필터는 setDrawRange(숫자 두 개)로 끝난다 —
// 필터를 바꿔도 버퍼는 다시 만들지 않는다.
//
// material.linewidth 는 WebGL2 데스크탑에서 무효다(ALIASED_LINE_WIDTH_RANGE = [1,1]).
// 그래서 링크/시맨틱 구분은 1px 에서 색상 + 알파로만 실린다.

import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGraphStore } from '../stores/graph-store.js';

/* ── edge buffer core ────────────────────────────────────────────────────────────────────
   [EDGE-BUFFER-CORE:BEGIN]
   이 마커 사이는 순수 함수 구간이다 — three / react / store 의존이 없다. 이 패키지에는 vitest 가
   없어서, 저장소 밖(A:/claude-temp)의 검증 스크립트가 이 구간만 떼어 transpile 한 뒤 버퍼 배치를
   직접 검증한다. 마커 안에 import 가 필요한 코드를 넣지 말 것.                                   */

export interface EdgeLike {
  source: string;
  target: string;
  weight: number;
  /** 없으면 'semantic' — packages/core types/graph.ts GraphEdge.kind 와 같은 규약. */
  kind?: 'link' | 'semantic';
}

export interface EdgeOrder<E extends EdgeLike> {
  /** 링크 엣지가 먼저, 그 뒤 시맨틱. 슬롯 i 는 버퍼의 세그먼트 i 와 1:1 이다. */
  ordered: E[];
  linkCount: number;
  /** nodeId → 그 노드가 끝점인 슬롯 번호들. hover 증분 repaint 를 O(degree) 로 만드는 인덱스. */
  adjacency: Map<string, number[]>;
  /** 시맨틱 엣지의 알파 배율(WEIGHT_FLOOR~1). 링크는 항상 1. */
  weightFactor: Float32Array;
}

/** 가장 약한 시맨틱 엣지도 이 비율 아래로는 흐려지지 않는다 — 완전히 사라지면 구조가 끊겨 보인다. */
const WEIGHT_FLOOR = 0.65;

export function orderEdgesByKind<E extends EdgeLike>(edges: readonly E[]): EdgeOrder<E> {
  const links: E[] = [];
  const semantic: E[] = [];
  for (const e of edges) (e.kind === 'link' ? links : semantic).push(e);

  const ordered = links.concat(semantic);
  const linkCount = links.length;
  const adjacency = new Map<string, number[]>();
  const weightFactor = new Float32Array(ordered.length);

  // 정규화는 시맨틱 구간에서만 뽑는다. 링크 weight 는 의미가 다른 축이라(존재 여부지 신뢰도가
  // 아니다) 같은 min/max 에 섞으면 시맨틱 대비가 뭉개진다.
  let wMin = Infinity;
  let wMax = -Infinity;
  for (let i = linkCount; i < ordered.length; i++) {
    const w = ordered[i].weight;
    if (!Number.isFinite(w)) continue;
    if (w < wMin) wMin = w;
    if (w > wMax) wMax = w;
  }
  const span = wMax - wMin;

  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    let a = adjacency.get(e.source);
    if (a === undefined) { a = []; adjacency.set(e.source, a); }
    a.push(i);
    if (e.target !== e.source) {
      let b = adjacency.get(e.target);
      if (b === undefined) { b = []; adjacency.set(e.target, b); }
      b.push(i);
    }

    weightFactor[i] = (i < linkCount || !(span > 0) || !Number.isFinite(e.weight))
      ? 1
      : WEIGHT_FLOOR + (1 - WEIGHT_FLOOR) * ((e.weight - wMin) / span);
  }

  return { ordered, linkCount, adjacency, weightFactor };
}

export interface EdgePalette {
  /** working(linear) color space 로 변환된 RGB. THREE.Color 가 sRGB hex 를 변환해 준다. */
  link: readonly [number, number, number];
  semantic: readonly [number, number, number];
  lit: readonly [number, number, number];
  linkAlpha: number;
  semanticAlpha: number;
  litAlpha: number;
  /** 다른 노드가 포커스를 쥐고 있을 때 나머지 엣지에 곱하는 배율. */
  dimScale: number;
  /** 링크 엣지 source 쪽 정점의 알파 배율 — 방향 테이퍼. */
  taper: number;
}

/**
 * 슬롯 하나(= 정점 2개 = RGBA 8 float)의 색을 컬러 버퍼에 직접 쓴다.
 *
 * 스타일 객체를 만들어 반환했다가 쓰는 형태였는데, 전체 repaint 는 70,398 슬롯을 도는 루프라
 * 슬롯마다 객체 하나 = 70k 할당이었다. 버퍼에 바로 쓰면 그 할당이 통째로 사라진다.
 * (구체적 ms 수치는 이 주석에 싣지 않는다 — 재현 확인된 값이 아니다.)
 */
export function writeEdgeSlot(
  colors: Float32Array,
  slot: number,
  pal: EdgePalette,
  isLink: boolean,
  isLit: boolean,
  dimmed: boolean,
  weightFactor: number,
  dead: boolean,
): void {
  const o = slot * 8;

  // 끝점이 현재 노드 집합에 없는 엣지는 길이 0 세그먼트로 접히므로(fillEdgePositions) 알파도 0.
  if (dead) {
    for (let k = 0; k < 8; k++) colors[o + k] = 0;
    return;
  }

  const rgb = isLit ? pal.lit : isLink ? pal.link : pal.semantic;
  const base = isLink ? pal.linkAlpha : pal.semanticAlpha * weightFactor;
  // lit 은 "올려주는" 값이지 덮어쓰는 값이 아니다. litAlpha 는 리라이트 이전의 균일 opacity 를
  // 그대로 재현한 값이라 시맨틱(다크 0.12)보다는 높지만 링크(다크 0.50)보다는 낮다 — 그냥
  // 대입하면 링크 엣지가 포커스될 때 오히려 어두워져서, 이 리라이트가 만들려던 두 계층 구분이
  // hover 순간 뒤집혔다. max 로 두면 시맨틱은 밝아지고 링크는 최소한 자기 밝기를 유지한다
  // (색은 어차피 pal.lit 로 바뀌므로 포커스는 색으로도 읽힌다).
  let alpha = isLit ? Math.max(pal.litAlpha, base) : base;
  if (dimmed) alpha *= pal.dimScale;

  // 방향 단서는 링크 엣지에서 공짜다: 세그먼트가 이미 서로 다른 정점 2개를 갖고 있으므로 source
  // 쪽 알파만 낮추면 target 쪽으로 짙어지는 테이퍼가 된다. GL_LINES 는 캡을 못 그리니 화살촉
  // geometry 는 애초에 불가능하다. 시맨틱은 무방향이라 평평하게 둔다 — 그라디언트를 넣으면
  // 존재하지 않는 방향을 주장하게 된다.
  const srcAlpha = isLink ? alpha * pal.taper : alpha;

  colors[o] = rgb[0]; colors[o + 1] = rgb[1]; colors[o + 2] = rgb[2]; colors[o + 3] = srcAlpha;
  colors[o + 4] = rgb[0]; colors[o + 5] = rgb[1]; colors[o + 6] = rgb[2]; colors[o + 7] = alpha;
}

/** position 버퍼를 제자리에서 다시 채우고, 끝점을 못 찾은 슬롯 수를 돌려준다. */
export function fillEdgePositions<E extends EdgeLike>(
  positions: Float32Array,
  dead: Uint8Array,
  ordered: readonly E[],
  positionOf: (id: string) => readonly number[] | undefined,
): number {
  let deadCount = 0;
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    const s = positionOf(e.source);
    const t = positionOf(e.target);
    const o = i * 6;
    if (s === undefined || t === undefined) {
      dead[i] = 1;
      deadCount++;
      positions[o] = 0; positions[o + 1] = 0; positions[o + 2] = 0;
      positions[o + 3] = 0; positions[o + 4] = 0; positions[o + 5] = 0;
      continue;
    }
    dead[i] = 0;
    positions[o] = s[0]; positions[o + 1] = s[1]; positions[o + 2] = s[2];
    positions[o + 3] = t[0]; positions[o + 4] = t[1]; positions[o + 5] = t[2];
  }
  return deadCount;
}

/**
 * 3-way 필터 → [start, count]. 비인덱스 geometry 의 drawRange 는 VERTEX 단위다
 * (three 0.170 renderBufferDirect 가 position.count 와 직접 비교한다). 세그먼트 1 = 정점 2.
 */
export function edgeDrawRange(
  filter: 'both' | 'links' | 'semantic',
  linkCount: number,
  total: number,
): [number, number] {
  if (filter === 'links') return [0, linkCount * 2];
  if (filter === 'semantic') return [linkCount * 2, (total - linkCount) * 2];
  return [0, total * 2];
}

/* [EDGE-BUFFER-CORE:END]
   ──────────────────────────────────────────────────────────────────────────────────────── */

// 시맨틱은 오늘 쓰던 쿨 블루를 유지하고, 링크만 색상환 반대편(앰버)로 뺐다. 다크 모드는 가산
// 블렌딩이라 겹치는 시맨틱 엣지가 블루-화이트 쪽으로 누적되는데, 앰버는 R/G 채널로 분리되므로
// 그 누적 위에서도 여전히 다른 색으로 읽힌다.
const EDGE_HEX = {
  dark: { semantic: '#4466aa', link: '#ffb454', lit: '#6699cc', litPulse: '#66ddff' },
  light: { semantic: '#8890a0', link: '#c2681a', lit: '#3355aa', litPulse: '#4466cc' },
} as const;

function linearRgb(hex: string): [number, number, number] {
  // ColorManagement.enabled 가 기본 true 라 sRGB hex → working(linear) 변환이 여기서 일어난다.
  // 정점 컬러 버퍼는 변환 없이 그대로 쓰이므로, 이 값을 넣어야 material.color 로 넘길 때와
  // 같은 색이 나온다.
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

function makePalette(isLight: boolean, isClusterView: boolean, hasPulse: boolean): EdgePalette {
  const hex = isLight ? EDGE_HEX.light : EDGE_HEX.dark;
  return {
    semantic: linearRgb(hex.semantic),
    link: linearRgb(hex.link),
    lit: linearRgb(hasPulse ? hex.litPulse : hex.lit),
    // weightFactor(0.65~1)가 곱해지므로 평균이 리라이트 이전의 균일 opacity 와 맞도록 상단을
    // 잡았다. 다크 raw 0.12*0.83 ≈ 0.1 (이전 0.1), 라이트 raw 0.42*0.83 ≈ 0.35 (이전 0.35).
    // 클러스터 메타 엣지는 super-node 를 덮지 않을 만큼만: 다크 0.24*0.83 ≈ 0.2, 라이트 ≈ 0.26.
    semanticAlpha: isLight ? (isClusterView ? 0.31 : 0.42) : (isClusterView ? 0.24 : 0.12),
    // 링크는 소수라 가산 누적이 없다. 다크 0.50 은 시맨틱 헤이즈(피크 0.12)의 4배 이상이라
    // 헤이즈가 여러 겹 쌓여도 링크가 그 위로 올라온다.
    linkAlpha: isLight ? 0.62 : 0.50,
    litAlpha: isLight ? (hasPulse ? 0.5 : 0.6) : (hasPulse ? 0.08 : 0.2),
    // 이전의 hasInteraction 분기값을 그대로 재현: 다크 0.12*0.042 ≈ 0.005, 라이트 0.42*0.071 ≈ 0.03.
    dimScale: isLight ? 0.071 : 0.042,
    taper: 0.22,
  };
}

const NO_SLOTS: readonly number[] = [];
const ORIGIN: readonly number[] = [0, 0, 0];

export function GraphEdges() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const highlightedNodeIds = useGraphStore((s) => s.highlightedNodeIds);
  const theme = useGraphStore((s) => s.theme);
  const view = useGraphStore((s) => s.view);
  const edgeFilter = useGraphStore((s) => s.edgeFilter);

  const isLight = theme === 'light';
  // 이전엔 nodes.some(n => n.isCluster) 였다 — 렌더마다 12,850개를 훑는다. 클러스터 갤럭시는 전부
  // super-node 로 균질하므로(useLayout / Graph3D 도 같은 판정을 쓴다) 첫 노드만 보면 O(1) 이다.
  // 서버 baked 갤럭시에서만 클러스터용 팔레트/페이드를 쓴다. 예전엔 nodes[0].isCluster 였고,
  // 그 전엔 nodes.some(...) 이라 렌더마다 전체를 훑었다. 이제 스토어 플래그 하나다.
  const isClusterView = useGraphStore((s) => s.sceneBaked);
  const activeId = hoveredNodeId || selectedNodeId;
  const hasPulse = highlightedNodeIds.size > 0;
  const hasInteraction = hasPulse || !!activeId;

  const objRef = useRef<THREE.LineSegments>(null);
  const matRef = useRef<THREE.LineBasicMaterial>(null);

  // (A) 정렬 + 인접맵 — hover 와 무관하게 엣지 집합이 바뀔 때만.
  const { ordered, linkCount, adjacency, weightFactor } = useMemo(
    () => orderEdgesByKind(edges),
    [edges],
  );

  // (B) geometry 는 엣지 집합당 1회 할당. 이후 위치 갱신은 이 버퍼를 제자리에서 덮어쓴다.
  const { geometry, dead } = useMemo(() => {
    const segs = ordered.length;
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(segs * 6), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.BufferAttribute(new Float32Array(segs * 8), 4);
    col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pos);
    g.setAttribute('color', col);
    // 명시적으로 박아 두면 three 가 lazy computeBoundingSphere() (정점 O(V)) 를 돌리지 않는다.
    // 어차피 항상 프러스텀과 교차하는 hairball 이라 컬링으로 얻을 게 없다.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
    return { geometry: g, dead: new Uint8Array(segs) };
  }, [ordered]);

  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
  const colorArray = colorAttr.array as Float32Array;
  const palette = useMemo(
    () => makePalette(isLight, isClusterView, hasPulse),
    [isLight, isClusterView, hasPulse],
  );

  // 슬롯 하나의 색을 현재 렌더의 상태로 다시 계산해 쓴다. 전체 repaint 와 증분 repaint 가 같은
  // 함수를 쓰므로, "포커스 해제 시 원래 색으로 복원" 이 별도 분기 없이 정확해진다.
  const paintSlot = (i: number) => {
    const e = ordered[i];
    const isLit = hasPulse
      // 하이라이트: 양쪽 다 하이라이트된 엣지만 밝게 (기존 동작 유지)
      ? highlightedNodeIds.has(e.source) && highlightedNodeIds.has(e.target)
      : activeId !== null && (e.source === activeId || e.target === activeId);
    writeEdgeSlot(
      colorArray, i, palette,
      i < linkCount, isLit, hasInteraction && !isLit, weightFactor[i], dead[i] === 1,
    );
  };

  // 씬 콘텐츠의 최대 반경(원점 기준). 거리 페이드가 고정 상수 대신 이걸 쓴다 — 아래 useFrame 참조.
  const contentRRef = useRef(250);
  const paintedGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const deadCountRef = useRef(-1);
  const prevActiveRef = useRef<string | null>(null);

  const repaintAll = () => {
    for (let i = 0; i < ordered.length; i++) paintSlot(i);
    // 증분 repaint 가 남긴 부분 업로드 범위가 있으면 three 는 그 범위만 올린다. 전체 업로드를
    // 강제하려면 먼저 비워야 한다.
    colorAttr.clearUpdateRanges();
    colorAttr.needsUpdate = true;
    paintedGeoRef.current = geometry;
    // ★같은 커밋에서 아래 증분 effect 가 뒤이어 돌면 addUpdateRange 를 다시 쌓고, three 는
    // 전체 업로드 대신 그 슬롯만 부분 업로드한다(WebGLAttributes: updateRanges 가 비어있을
    // 때만 버퍼 전체 bufferSubData). 그러면 방금 칠한 "나머지 엣지 dimming" 이 GPU 에 영영
    // 안 올라간다 — idle→hover 전이는 hasInteraction 이 뒤집혀 항상 이 경로였다.
    // repaintAll 은 이미 현재 activeId 기준으로 전 슬롯을 칠했으므로 증분 델타는 정의상 비어
    // 있다. 포커스 커서를 여기서 맞춰두면 아래 effect 가 첫 가드에서 그대로 빠져나간다.
    prevActiveRef.current = activeId;
  };

  // 위치 in-place 리필. layout.worker 의 progress 마다 nodes 배열 identity 가 바뀌므로 여기까지는
  // 매번 다시 돈다 — 하지만 이제 버퍼/색 재할당은 없고 Float32Array 덮어쓰기만 남는다.
  // 아래 전체 repaint effect 보다 먼저 선언되어야 한다: dead[] 를 채우는 쪽이 이 effect 다.
  useEffect(() => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const nodePos = new Map<string, readonly number[]>();
    for (const n of nodes) nodePos.set(n.id, n.position ?? ORIGIN);

    const deadCount = fillEdgePositions(pos.array as Float32Array, dead, ordered, (id) => nodePos.get(id));
    pos.clearUpdateRanges();
    pos.needsUpdate = true;

    // 콘텐츠 반경 — 아래 거리 페이드가 이걸 기준으로 돈다. 노드 배열을 도는 편이 위치 버퍼를
    // 훑는 것보다 싸다(엣지 수 >> 노드 수).
    let maxR = 0;
    for (const n of nodes) {
      const q = n.position;
      if (!q) continue;
      const r = q[0] * q[0] + q[1] * q[1] + q[2] * q[2];
      if (r > maxR && Number.isFinite(r)) maxR = r;
    }
    contentRRef.current = Math.max(1, Math.sqrt(maxR));

    // 노드가 아직 안 들어온 첫 커밋에서는 전부 dead 였다가 데이터가 도착하면 살아난다. 색은
    // nodes 를 deps 로 갖지 않으므로, dead 집합이 실제로 바뀐 순간에만 다시 칠해 준다.
    // (geometry 가 새로 생긴 커밋은 바로 아래 전체 repaint 가 어차피 돌므로 건너뛴다.)
    if (paintedGeoRef.current === geometry && deadCount !== deadCountRef.current) repaintAll();
    deadCountRef.current = deadCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, dead, ordered, nodes]);

  // (C) 전체 repaint — 테마 / 클러스터뷰 / hasInteraction 불리언 / 하이라이트 집합이 바뀔 때만.
  // activeId 는 일부러 deps 에서 뺐다: hover 마다 O(E) 를 다시 도는 것이 이 리라이트가 없애려던
  // 바로 그 비용이다. effect 클로저는 렌더마다 새로 만들어지므로 실제로 실행될 때 값은 항상
  // 최신이고, hover 변화는 아래 증분 effect 가 O(degree) 로 따라간다.
  useEffect(() => {
    repaintAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, ordered, linkCount, palette, hasInteraction, hasPulse, highlightedNodeIds]);

  // hover / select 증분 repaint. 직전 포커스 노드의 엣지를 원래 색으로 되돌리고 새 포커스 노드의
  // 엣지만 밝힌다 — 건드리는 슬롯은 두 노드의 degree 합뿐이고, 업로드도 addUpdateRange 로
  // 그 슬롯들만 올린다(전체 버퍼 재업로드 없음).
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeId;
    if (prev === activeId) return;
    // pulse 중에는 lit 판정이 하이라이트 집합만으로 결정된다(기존 동작) → 다시 칠할 것이 없다.
    if (hasPulse) return;

    let touched = 0;
    const repaintStar = (id: string | null) => {
      if (id === null) return;
      for (const i of adjacency.get(id) ?? NO_SLOTS) {
        paintSlot(i);
        colorAttr.addUpdateRange(i * 8, 8);
        touched++;
      }
    };
    repaintStar(prev);
    repaintStar(activeId);
    if (touched === 0) return;
    // updateRanges 는 실제 업로드가 일어날 때만 비워진다. 줌아웃으로 obj.visible=false 인 동안
    // hover 를 계속하면 플러시될 프레임이 없어 범위가 쌓이므로, 일정 수를 넘으면 그냥 버리고
    // 전체 업로드로 되돌린다 (전체 업로드는 어차피 정확하다 — 범위는 최적화일 뿐이다).
    if (colorAttr.updateRanges.length > 512) colorAttr.clearUpdateRanges();
    colorAttr.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, geometry, adjacency, hasPulse]);

  // 3-way 필터는 버퍼를 다시 만들지 않는다 — 링크가 앞쪽에 몰려 있으므로 숫자 두 개면 끝난다.
  useEffect(() => {
    const [start, count] = edgeDrawRange(edgeFilter, linkCount, ordered.length);
    geometry.setDrawRange(start, count);
  }, [geometry, edgeFilter, linkCount, ordered.length]);

  // 줌아웃 시 엣지 페이드아웃 (별자리 뷰와 충돌 방지)
  useFrame(({ camera }) => {
    const mat = matRef.current;
    const obj = objRef.current;
    if (!mat || !obj) return;
    const dist = camera.position.length();
    let fade = 1;
    if (isClusterView) {
      // The cluster GALAXY is framed from ~600+, so the raw view's 300→500 fade would zero
      // the meta-edges entirely (the "links invisible" report). The skeleton is only ~56
      // aggregated edges — keep it visible far out, fading only when truly zoomed away.
      if (dist > 1700) fade = 0;
      else if (dist > 1300) fade = 1 - (dist - 1300) / 400;
    } else {
      // 페이드 구간을 콘텐츠 반경에 비례시킨다.
      //
      // 예전엔 300→500 고정이었다. 그 값은 레이아웃 부피가 항상 brainScale 기본값(반경 250)
      // 이던 시절 것이라, 전량 볼트에서 부피가 노드 수에 맞춰 커지자(layout.worker 밀도 보정)
      // fitView 가 카메라를 500 밖으로 빼면서 엣지가 통째로 사라졌다 — 화면에는 별자리
      // 레이어의 선만 남아 "엣지가 그려지고 있다"고 착각하기 딱 좋은 상태였다.
      //
      // ★비율도 처음엔 1.2R→2.0R 로 잡았는데(= 옛 상수의 R=250 재현) 그래도 틀렸다. fitView 는
      // 바운딩 스피어를 화면에 맞추느라 카메라를 항상 2.5R 부근에 세운다(fov 55°, 실측 205R →
      // 522, ratio 2.55). 즉 "화면에 딱 맞게 보이는 기본 상태"가 이미 2.0R 밖이라, 어떤 씬을
      // 열어도 엣지 레이어가 opacity 0 으로 시작했다. 페이드는 사용자가 기본 프레이밍보다
      // 더 멀리 물러났을 때만 걸려야 한다 — 그래서 기준선을 프레이밍 거리(≈2.6R) 위에 둔다.
      const r = contentRRef.current;
      const fadeStart = r * 3.2;
      const fadeEnd = r * 5.0;
      if (dist > fadeEnd) fade = 0;
      else if (dist > fadeStart) fade = 1 - (dist - fadeStart) / (fadeEnd - fadeStart);
    }
    // 베이스 알파는 이제 정점 컬러가 들고 있다. material.opacity 는 순수 거리 페이드 계수다
    // (최종 알파 = opacity * vColor.a).
    mat.opacity = fade;
    // 완전히 사라진 프레임에서는 draw call 자체를 건너뛴다.
    obj.visible = fade > 0.001;
  });

  if (ordered.length === 0) return null;

  return (
    <lineSegments ref={objRef} geometry={geometry}>
      <lineBasicMaterial
        ref={matRef}
        // 색과 알파는 전부 RGBA 정점 컬러에서 온다. three 0.170 은
        // vertexColors === true && color.itemSize === 4 일 때만 USE_COLOR_ALPHA 를 켜므로
        // 둘 중 하나라도 빠지면 알파가 조용히 무시된다.
        vertexColors
        color={0xffffff}
        transparent
        opacity={1}
        depthWrite={false}
        blending={isLight ? THREE.NormalBlending : THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}
