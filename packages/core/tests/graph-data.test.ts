import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import type { VectorStore } from '../src/store/types.js';
import { buildGraphData } from '../src/api/graph-data.js';

const DIMS = 4;
let store: VectorStore;

beforeEach(async () => {
  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();

  // 3개 문서 삽입
  for (let i = 0; i < 3; i++) {
    await store.upsertDocument({
      id: `doc${i}`, filePath: `folder${i}/test.md`, title: `Doc ${i}`,
      content: `Content ${i}`, frontmatter: {}, tags: ['test'],
      lastModified: '2026-01-01', contentHash: `hash${i}`,
    });
    await store.upsertChunks([{
      id: `doc${i}#0`, documentId: `doc${i}`, content: `Content ${i}`,
      heading: `Doc ${i}`, startLine: 1, endLine: 1, tokenCount: 2,
      embedding: [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0, 0.5],
    }]);
  }
});

afterEach(async () => { await store.close(); });

describe('buildGraphData', () => {
  it('semantic 모드: 노드 수 = 문서 수', async () => {
    const data = await buildGraphData(store, { mode: 'semantic' });
    expect(data.nodes.length).toBe(3);
    expect(data.stats.nodeCount).toBe(3);
  });

  it('노드에 필수 필드 존재', async () => {
    const data = await buildGraphData(store);
    const node = data.nodes[0];
    expect(node.id).toBeDefined();
    expect(node.label).toBeDefined();
    expect(node.filePath).toBeDefined();
    expect(node.clusterId).toBeTypeOf('number');
    expect(node.size).toBeGreaterThan(0);
  });

  it('엣지 threshold 이상만 생성', async () => {
    const data = await buildGraphData(store, { edgeThreshold: 0.99 });
    // 직교 벡터라 유사도 < 0.99 → 엣지 없음
    expect(data.edges.length).toBe(0);
  });

  it('엣지 threshold 낮으면 연결 생성', async () => {
    const data = await buildGraphData(store, { edgeThreshold: 0.0 });
    expect(data.edges.length).toBeGreaterThan(0);
    for (const edge of data.edges) {
      expect(edge.source).toBeDefined();
      expect(edge.target).toBeDefined();
      expect(edge.weight).toBeGreaterThanOrEqual(0);
    }
  });

  it('folder 모드: 폴더별 클러스터', async () => {
    const data = await buildGraphData(store, { mode: 'folder' });
    expect(data.clusters.length).toBe(3); // folder0, folder1, folder2
    for (const c of data.clusters) {
      expect(c.label).toBeDefined();
      expect(c.nodeCount).toBeGreaterThan(0);
      expect(c.color).toMatch(/^#/);
    }
  });

  it('클러스터에 컬러와 라벨 존재', async () => {
    const data = await buildGraphData(store);
    for (const c of data.clusters) {
      expect(c.color).toMatch(/^#/);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it('stats 정확', async () => {
    const data = await buildGraphData(store);
    expect(data.stats.nodeCount).toBe(data.nodes.length);
    expect(data.stats.edgeCount).toBe(data.edges.length);
    expect(data.stats.clusterCount).toBe(data.clusters.length);
  });
});
