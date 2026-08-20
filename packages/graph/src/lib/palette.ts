// 클러스터 팔레트 — 렌더러 측 단일 소스.
//
// `PALETTE_HEX` 는 packages/core/src/api/graph-data.ts 의 동명 배열과 **바이트 단위로 동일**해야
// 한다. 서버는 clusters[].color(ClusterFilter 스와치)를 core 배열에서 뽑고 렌더러는 점/행성/라벨
// 색을 이 배열에서 뽑기 때문에, 둘이 어긋나면 스와치와 실제 색이 달라진다. `npm run check:palette`
// 가 드리프트를 빌드에서 잡는다.
//
// 예전에는 이 배열이 GraphNodes / ClusterLabels / ClusterPlanets 에 각각 복사돼 있었고(core 까지
// 4벌), 그중 하나만 고치면 조용히 어긋났다. 이제 렌더러는 전부 여기서 import 한다.
//
// 80색 = buildClusteredGraph 의 클러스터 상한(Math.min(80, …)). 이전 15색에서는 기본 ~35개
// 클러스터가 팔레트를 넘겨 서로 무관한 행성 ~2.3개가 같은 색을 공유했다 — "같은 색 = 같은 그룹"
// 이라는 이 뷰의 존재 이유가 깨져 있었다.
export const PALETTE_HEX = [
  '#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#8b5cf6',
  '#14b8a6', '#e879f9', '#eab308', '#22d3ee', '#fb7185',
  '#e19647', '#90dfd0', '#d411c1', '#a5e147', '#90a9df',
  '#d41116', '#47e170', '#bc90df', '#d4b711', '#47cbe1',
  '#df90bd', '#47d411', '#4a47e1', '#dfa990', '#11d487',
  '#d147e1', '#d0df90', '#1177d4', '#e1476a', '#90df95',
  '#5611d4', '#e1aa47', '#90dfda', '#d411a8', '#91e147',
  '#909fdf', '#d42511', '#47e184', '#c690df', '#d4d011',
  '#47b7e1', '#df90b3', '#2ed411', '#5d47e1', '#dfb390',
  '#11d4a0', '#e147de', '#c6df90', '#115ed4', '#e14757',
  '#90df9f', '#6f11d4', '#e1be47', '#90dadf', '#d4118f',
  '#7de147', '#9095df', '#d43e11', '#47e197', '#d090df',
  '#bfd411', '#47a4e1', '#df90a9', '#15d411', '#7147e1',
  '#dfbd90', '#11d4b8', '#e147ca', '#bcdf90', '#1145d4',
  '#e14b47', '#90dfa9', '#8811d4', '#e1d247', '#90d0df',
];

/** clusterId → hex. 음수 id 도 안전하게 감싼다(서버의 paletteHex 와 동일 규칙). */
export function paletteHex(clusterId: number): string {
  return PALETTE_HEX[((clusterId % PALETTE_HEX.length) + PALETTE_HEX.length) % PALETTE_HEX.length];
}

/** 같은 팔레트를 0..1 RGB 로. three.js 의 BufferAttribute 색상 채우기용. */
export const PALETTE_RGB: number[][] = PALETTE_HEX.map((hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
]);
