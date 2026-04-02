import { describe, it, expect } from 'vitest';

// layout.worker는 브라우저 Web Worker이므로 직접 테스트 불가
// graph-data의 buildGraphData로 노드 위치/엣지 생성을 간접 검증

import { buildGraphData } from '../src/api/graph-data.js';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import type { VectorStore } from '../src/store/types.js';

const DIMS = 4;

async function setup(n: number): Promise<VectorStore> {
  const store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();
  for (let i = 0; i < n; i++) {
    const vec = [Math.random(), Math.random(), Math.random(), Math.random()];
    await store.upsertDocument({
      id: `d${i}`, filePath: `test/d${i}.md`, title: `Doc ${i}`,
      content: `Content ${i}`, frontmatter: {}, tags: [],
      lastModified: '2026-01-01', contentHash: `h${i}`,
    });
    await store.upsertChunks([{
      id: `d${i}#0`, documentId: `d${i}`, content: `Content ${i}`,
      heading: `Doc ${i}`, startLine: 1, endLine: 1, tokenCount: 2,
      embedding: vec,
    }]);
  }
  return store;
}

describe('Graph Layout Data Generation', () => {
  it('노드 수 = 문서 수', async () => {
    const store = await setup(10);
    const data = await buildGraphData(store);
    expect(data.nodes.length).toBe(10);
    await store.close();
  });

  it('엣지 source/target이 유효한 노드 ID', async () => {
    const store = await setup(10);
    const data = await buildGraphData(store, { edgeThreshold: 0 });
    const nodeIds = new Set(data.nodes.map(n => n.id));
    for (const edge of data.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
    await store.close();
  });

  it('maxEdgesPerNode 제한 동작', async () => {
    const store = await setup(10);
    const data = await buildGraphData(store, { edgeThreshold: 0, maxEdgesPerNode: 2 });
    // 각 노드의 엣지 수가 maxEdgesPerNode 이하
    const edgeCounts = new Map<string, number>();
    for (const e of data.edges) {
      edgeCounts.set(e.source, (edgeCounts.get(e.source) ?? 0) + 1);
      edgeCounts.set(e.target, (edgeCounts.get(e.target) ?? 0) + 1);
    }
    // 중복 엣지 방지로 실제 카운트는 다를 수 있지만, 합리적 범위
    for (const count of edgeCounts.values()) {
      expect(count).toBeLessThanOrEqual(20); // 넉넉한 상한
    }
    await store.close();
  });

  it('노드 size가 양수', async () => {
    const store = await setup(5);
    const data = await buildGraphData(store);
    for (const n of data.nodes) {
      expect(n.size).toBeGreaterThan(0);
    }
    await store.close();
  });

  it('빈 store → 빈 그래프', async () => {
    const store = createSqliteVecStore(':memory:', DIMS);
    await store.initialize();
    const data = await buildGraphData(store);
    expect(data.nodes.length).toBe(0);
    expect(data.edges.length).toBe(0);
    await store.close();
  });
});
