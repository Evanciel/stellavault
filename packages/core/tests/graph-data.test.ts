import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import type { VectorStore } from '../src/store/types.js';
import { buildGraphData, flattenClusterLevel } from '../src/api/graph-data.js';
import type { ClusterLevelGraph } from '../src/types/graph.js';

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

describe('flattenClusterLevel', () => {
  const level: ClusterLevelGraph = {
    level: 'galaxy',
    superNodes: [
      { clusterId: 0, label: 'Projects', color: '#6366f1', memberCount: 42, position: [1, 2, 3], size: 8.48, representativeId: 'docA' },
      { clusterId: 2, label: 'Notes', color: '#f59e0b', memberCount: 9, position: [-4, 5, -6], size: 5, representativeId: 'docB' },
    ],
    metaEdges: [
      { sourceCluster: 0, targetCluster: 2, weight: 1.5, count: 7 },
    ],
    totalNodes: 51,
    totalEdges: 30,
    layoutVersion: 'semantic',
  };

  it('super-node → GraphNode with cluster:N id, isCluster, memberCount, representativeId, baked position', () => {
    const data = flattenClusterLevel(level);
    expect(data.nodes.length).toBe(2);
    const n0 = data.nodes[0];
    expect(n0.id).toBe('cluster:0');
    expect(n0.isCluster).toBe(true);
    expect(n0.memberCount).toBe(42);
    expect(n0.representativeId).toBe('docA');
    expect(n0.position).toEqual([1, 2, 3]); // baked galaxy position preserved verbatim
    expect(n0.size).toBe(8.48);
    expect(n0.source).toBe('cluster');
    expect(n0.type).toBe('cluster');
    expect(data.nodes[1].id).toBe('cluster:2');
  });

  it('meta-edge → GraphEdge with cluster:N source/target + weight (count dropped)', () => {
    const data = flattenClusterLevel(level);
    expect(data.edges.length).toBe(1);
    expect(data.edges[0]).toEqual({ source: 'cluster:0', target: 'cluster:2', weight: 1.5 });
  });

  it('clusters[] from super-nodes; stats counts mirror nodes/edges/clusters', () => {
    const data = flattenClusterLevel(level);
    expect(data.clusters.map((c) => c.id)).toEqual([0, 2]);
    expect(data.clusters[0].nodeCount).toBe(42);
    expect(data.stats.nodeCount).toBe(2);
    expect(data.stats.edgeCount).toBe(1);
    expect(data.stats.clusterCount).toBe(2);
  });

  it('COLOR DECISION (a): clusters[].color is the renderer-aligned PALETTE hex, NOT CLUSTER_COLORS', () => {
    // Documented decision: the ClusterFilter swatch is synthesized from the renderer's
    // PALETTE (PALETTE_HEX in graph-data.ts), so the swatch matches the rendered dot color.
    // The pre-existing CLUSTER_COLORS array (sn.color, index 0 = #6366f1) differs in order
    // AND length from PALETTE_HEX (index 0 = #7c3aed). We deliberately do NOT inherit sn.color.
    const data = flattenClusterLevel(level);
    expect(data.clusters[0].color).toBe('#7c3aed'); // PALETTE_HEX[0], not CLUSTER_COLORS[0] (#6366f1)
    expect(data.clusters[0].color).not.toBe(level.superNodes[0].color);
    expect(data.clusters[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
