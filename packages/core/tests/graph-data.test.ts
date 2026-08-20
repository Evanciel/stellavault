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

  // REGRESSION: `filePath.split('/')[0] ?? 'root'` — the `??` was dead (split always yields ≥1
  // element), so a vault-root note returned its own FILE NAME as its folder and became a
  // one-note "planet" labelled e.g. "Projects.md". All root notes belong in ONE bucket.
  it('folder 모드: 루트 노트는 파일마다 클러스터가 아니라 하나의 (root) 로 묶인다', async () => {
    for (const name of ['Projects', 'Inbox', 'Scratch']) {
      await store.upsertDocument({
        id: `root-${name}`, filePath: `${name}.md`, title: name,
        content: name, frontmatter: {}, tags: [],
        lastModified: '2026-01-02', contentHash: `h-${name}`,
      });
      await store.upsertChunks([{
        id: `root-${name}#0`, documentId: `root-${name}`, content: name,
        heading: name, startLine: 1, endLine: 1, tokenCount: 1,
        embedding: [0.5, 0.5, 0.5, 0.5],
      }]);
    }

    const data = await buildGraphData(store, { mode: 'folder' });
    const rootCluster = data.clusters.filter((c) => c.label === '(root)');
    expect(rootCluster.length).toBe(1);
    expect(rootCluster[0].nodeCount).toBe(3);
    // and no cluster is named after a file
    expect(data.clusters.some((c) => c.label.endsWith('.md'))).toBe(false);
  });

  // REGRESSION: folder mode ignored options.clusterCount entirely while the semantic branch
  // honoured it, so buildClusteredGraph's ceiling did not apply and a vault with many top-level
  // folders produced one planet per folder (palette exhausted, labels unreadable).
  it('folder 모드: clusterCount 상한을 지키고 롱테일을 (other) 로 접는다', async () => {
    for (let i = 3; i < 12; i++) {
      await store.upsertDocument({
        id: `extra${i}`, filePath: `folder${i}/n.md`, title: `Extra ${i}`,
        content: `Extra ${i}`, frontmatter: {}, tags: [],
        lastModified: '2026-01-01', contentHash: `he${i}`,
      });
      await store.upsertChunks([{
        id: `extra${i}#0`, documentId: `extra${i}`, content: `Extra ${i}`,
        heading: `Extra ${i}`, startLine: 1, endLine: 1, tokenCount: 1,
        embedding: [0.1, 0.2, 0.3, 0.4],
      }]);
    }

    const uncapped = await buildGraphData(store, { mode: 'folder' });
    expect(uncapped.clusters.length).toBe(12); // no clusterCount → unchanged behaviour

    const capped = await buildGraphData(store, { mode: 'folder', clusterCount: 4 });
    expect(capped.clusters.length).toBe(4);
    expect(capped.clusters[3].label).toMatch(/^\(other\) \(\d+\)$/);
    // every node still lands in a real cluster, and the counts add up to the node total
    const total = capped.clusters.reduce((sum, c) => sum + c.nodeCount, 0);
    expect(total).toBe(capped.nodes.length);
    for (const n of capped.nodes) {
      expect(n.clusterId).toBeGreaterThanOrEqual(0);
      expect(n.clusterId).toBeLessThan(4);
    }
  });

  // REGRESSION: the folder branch counted `docs` (the WHOLE vault) while nodes came from the
  // capped `docsWithVecs`, so clusters[] listed folders with zero nodes on screen and nodeCount
  // reported vault totals instead of what was rendered.
  it('folder 모드: nodeCap 적용 시 유령 클러스터가 없고 nodeCount 가 렌더된 수와 일치', async () => {
    // nodeCap floors at 200, so the cap only bites past 200 docs. `recent/` fills the cap and
    // `archive/` is older, so archive is ranked out entirely — under the old code it still showed
    // up in clusters[] as a folder with 0 rendered nodes but nodeCount 10.
    const mk = async (id: string, filePath: string, lastModified: string) => {
      await store.upsertDocument({
        id, filePath, title: id, content: id, frontmatter: {}, tags: [],
        lastModified, contentHash: `h-${id}`,
      });
      await store.upsertChunks([{
        id: `${id}#0`, documentId: id, content: id, heading: id,
        startLine: 1, endLine: 1, tokenCount: 1, embedding: [0.1, 0.2, 0.3, 0.4],
      }]);
    };
    for (let i = 0; i < 210; i++) await mk(`recent${i}`, `recent/n${i}.md`, '2026-05-01');
    for (let i = 0; i < 10; i++) await mk(`arch${i}`, `archive/n${i}.md`, '2020-01-01');

    const data = await buildGraphData(store, { mode: 'folder', nodeCap: 200 });
    expect(data.nodes.length).toBe(200); // cap applied

    const rendered = new Map<number, number>();
    for (const n of data.nodes) rendered.set(n.clusterId, (rendered.get(n.clusterId) ?? 0) + 1);

    expect(data.clusters.length).toBe(rendered.size); // no cluster without nodes on screen
    expect(data.clusters.some((c) => c.label === 'archive')).toBe(false);
    for (const c of data.clusters) {
      expect(c.nodeCount).toBe(rendered.get(c.id));
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

  it('COLOR DECISION (a): clusters[].color is synthesized from the renderer-aligned PALETTE', () => {
    // The ClusterFilter swatch is synthesized from PALETTE_HEX — the same literal the renderer
    // parses for dot colours — so the swatch always matches the dot it filters. An incoming
    // sn.color is NOT inherited (a stale/foreign colour would silently desync the swatch).
    const data = flattenClusterLevel(level);
    expect(data.clusters[0].color).toBe('#7c3aed'); // PALETTE_HEX[0]
    expect(data.clusters[0].color).not.toBe(level.superNodes[0].color);
    expect(data.clusters[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

// REGRESSION: the palette held 15 colours while buildClusteredGraph builds up to 80 clusters
// (default ≈35), so unrelated planets wrapped onto the same colour and "same colour = same
// group" was false. scripts/check-palette.mjs additionally pins core and graph to each other.
describe('cluster palette', () => {
  it('클러스터 상한(80)만큼의 서로 다른 색을 가진다', async () => {
    const seen = new Map<string, number>();
    for (let cid = 0; cid < 80; cid++) {
      const data = flattenClusterLevel({
        level: 'galaxy',
        superNodes: [{ clusterId: cid, label: `c${cid}`, color: '#000000', memberCount: 1, position: [0, 0, 0], size: 1, representativeId: 'x' }],
        metaEdges: [], totalNodes: 1, totalEdges: 0, layoutVersion: 'semantic',
      });
      const color = data.clusters[0].color;
      expect(seen.has(color)).toBe(false); // would fail at cid=15 with the old 15-colour palette
      seen.set(color, cid);
    }
    expect(seen.size).toBe(80);
  });
});
