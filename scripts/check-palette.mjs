#!/usr/bin/env node
// 클러스터 팔레트 드리프트 가드.
//
// 팔레트는 두 패키지에 각각 리터럴로 존재할 수밖에 없다 — packages/graph 는 @stellavault/core 에
// 의존하지 않는다(번들 크기/빌드 그래프 문제로 의존을 추가하지 않기로 함). 서버는 이 배열에서
// clusters[].color(= ClusterFilter 스와치)를, 렌더러는 점·행성·라벨 색을 뽑기 때문에 둘이 어긋나면
// "스와치 색 ≠ 실제 점 색"이 된다. 실제로 예전 CLUSTER_COLORS/PALETTE 불일치로 그 버그가 있었다.
//
// 그래서 사람 눈 대신 이 스크립트가 두 리터럴이 동일한지 확인한다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCES = [
  { label: 'core', file: join(root, 'packages/core/src/api/graph-data.ts') },
  { label: 'graph', file: join(root, 'packages/graph/src/lib/palette.ts') },
];

/** Extract the PALETTE_HEX array literal's hex entries, in order. */
function readPalette({ label, file }) {
  const src = readFileSync(file, 'utf8');
  const m = /PALETTE_HEX\s*(?::\s*[^=]+)?=\s*\[([\s\S]*?)\]/.exec(src);
  if (!m) throw new Error(`${label}: no PALETTE_HEX array literal found in ${file}`);
  const hexes = m[1].match(/#[0-9a-fA-F]{6}/g) ?? [];
  if (hexes.length === 0) throw new Error(`${label}: PALETTE_HEX is empty`);
  return hexes.map((h) => h.toLowerCase());
}

const fail = (msg) => { console.error(`✗ palette check: ${msg}`); process.exit(1); };

const [core, graph] = SOURCES.map(readPalette);

if (core.length !== graph.length) {
  fail(`length differs — core ${core.length} vs graph ${graph.length}`);
}
for (let i = 0; i < core.length; i++) {
  if (core[i] !== graph[i]) fail(`index ${i} differs — core ${core[i]} vs graph ${graph[i]}`);
}

// The cluster ceiling in buildClusteredGraph. Fewer colours than clusters means unrelated
// clusters share a colour, which makes "same colour = same group" false.
const CLUSTER_CEILING = 80;
if (core.length < CLUSTER_CEILING) {
  fail(`only ${core.length} colours for up to ${CLUSTER_CEILING} clusters — unrelated clusters would share a colour`);
}

const dupes = core.filter((h, i) => core.indexOf(h) !== i);
if (dupes.length > 0) fail(`duplicate colours: ${[...new Set(dupes)].join(', ')}`);

console.log(`✓ palette check: ${core.length} colours, identical in core and graph, no duplicates`);
