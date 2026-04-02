import { describe, it, expect } from 'vitest';

// graph-data.ts에서 K-means 내부 함수는 export 안 되므로, buildGraphData로 간접 테스트
import { buildGraphData } from '../src/api/graph-data.js';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import type { VectorStore } from '../src/store/types.js';

const DIMS = 4;

async function setupStore(docCount: number): Promise<VectorStore> {
  const store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();

  for (let i = 0; i < docCount; i++) {
    // 3그룹으로 나뉘는 벡터: [1,0,0,0], [0,1,0,0], [0,0,1,0]
    const group = i % 3;
    const vec = [0, 0, 0, 0.1];
    vec[group] = 1;

    await store.upsertDocument({
      id: `d${i}`, filePath: `folder${group}/doc${i}.md`, title: `Doc ${i} Group ${group}`,
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

describe('K-Means Clustering (via buildGraphData)', () => {
  it('클러스터 수가 5~10 범위', async () => {
    const store = await setupStore(30);
    const data = await buildGraphData(store, { mode: 'semantic' });
    expect(data.clusters.length).toBeGreaterThanOrEqual(3);
    expect(data.clusters.length).toBeLessThanOrEqual(10);
    await store.close();
  });

  it('모든 노드에 clusterId 할당', async () => {
    const store = await setupStore(15);
    const data = await buildGraphData(store);
    for (const node of data.nodes) {
      expect(node.clusterId).toBeTypeOf('number');
    }
    await store.close();
  });

  it('클러스터 라벨이 비어있지 않음', async () => {
    const store = await setupStore(15);
    const data = await buildGraphData(store);
    for (const c of data.clusters) {
      expect(c.label.length).toBeGreaterThan(0);
    }
    await store.close();
  });

  it('클러스터 nodeCount 합 = 전체 노드 수', async () => {
    const store = await setupStore(12);
    const data = await buildGraphData(store);
    const totalFromClusters = data.clusters.reduce((sum, c) => sum + c.nodeCount, 0);
    expect(totalFromClusters).toBe(data.nodes.length);
    await store.close();
  });

  it('folder 모드: 폴더 수만큼 클러스터', async () => {
    const store = await setupStore(9);
    const data = await buildGraphData(store, { mode: 'folder' });
    expect(data.clusters.length).toBe(3); // folder0, folder1, folder2
    await store.close();
  });
});
