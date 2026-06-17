// Design Ref: §4.2 — Graph Data 생성 알고리즘
// Design Ref: §6.2 — K-Means 클러스터링

import type { VectorStore } from '../store/types.js';
import type {
  GraphNode, GraphEdge, Cluster, GraphData,
  ClusterSuperNode, MetaEdge, ClusterLevelGraph, ClusterMembersGraph,
} from '../types/graph.js';
import { createHash } from 'node:crypto';

const CLUSTER_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4',
  '#84cc16', '#e879f9', '#22d3ee', '#a3e635', '#fb923c',
];

export type GraphMode = 'semantic' | 'folder';

export interface BuildGraphOptions {
  mode?: GraphMode;            // default: 'semantic'
  edgeThreshold?: number;      // default: 0.15
  maxEdgesPerNode?: number;    // default: 5
  clusterCount?: number;       // 0 = auto (Elbow)
  nodeCap?: number;            // max notes fed into the O(n²) edge/cluster pass (default 2000)
}

export async function buildGraphData(
  store: VectorStore,
  options: BuildGraphOptions = {},
): Promise<GraphData> {
  const {
    // 0.35: 384-dim 임베딩에서 의미있는 코사인 임계. 0.15는 사실상 모든 페어가 통과 →
    // 중간 neighbor 배열이 수백만 객체로 폭증(빌드 지연) + 시각적으로 과밀한 엣지 거미줄.
    edgeThreshold = 0.35,
    maxEdgesPerNode = 5,
  } = options;

  // 1. 문서 메타(content-free) + 임베딩 로드.
  //   ★2026-06-10 1M 대비: getAllDocuments() 는 전 문서 *본문*을 힙에 적재 → 대규모 OOM 의
  //   진짜 원인. 그래프는 본문 불요(id/title/path/tags/source/type/lastModified 만) → content-free
  //   getDocumentsMeta() 로 교체(다운스트림 17개 content 소비자는 getAllDocuments 그대로 유지).
  //   임베딩 상한은 env 로 조절(기본 20000 = 현재 11k 볼트 전부 커버 → 과거 10k 하드캡의 무음
  //   truncation 버그 해소). 초과 시 경고.
  // 1. content-free 메타만 먼저 로드(경량). 임베딩은 최근성 랭킹 후 NODE_CAP 만큼만 로드.
  //   ★PERF(측정 38×): 전체 12k 임베딩을 vec0 가상테이블에서 읽으면 ~11s, 실제 렌더하는
  //   ~1.5k만 chunk_id PK로 스코프 로드하면 ~0.3s. 본문은 그래프에 불요(OOM 회피 유지).
  const docs = await store.getDocumentsMeta();

  const edges: GraphEdge[] = [];
  const edgeCounts = new Map<string, number>();

  // Bound the O(n²) edge loop + k-means. Rank by recency (importance proxy), cap to
  // nodeCap, and scoped-load ONLY those embeddings (not all 12k — that read dominated
  // the build and froze the Electron main process).
  const NODE_CAP = Math.max(200, Math.floor(options.nodeCap ?? (Number(process.env.GRAPH_NODE_CAP) || 1500)));
  const ranked = [...docs].sort((a, b) => String(b.lastModified ?? '').localeCompare(String(a.lastModified ?? '')));
  if (docs.length > NODE_CAP) {
    console.warn(`[graph] capped to ${NODE_CAP} most-recent notes (of ${docs.length}) — raise GRAPH_NODE_CAP to include more.`);
  }
  const embeddings = await store.getDocumentEmbeddingsByIds(ranked.slice(0, NODE_CAP).map((d) => d.id));
  const docsWithVecs = ranked.filter((d) => embeddings.has(d.id)).slice(0, NODE_CAP);

  // 2. k-NN 엣지 — 정규화 벡터를 하나의 연속 Float32Array 로 패킹 후 인라인 코사인(단위벡터→내적).
  // 페어당 함수콜/배열 스프레드를 제거 → 1.5k 노드 (~1.1M 페어)도 빠르게 처리.
  const docIds = docsWithVecs.map((d) => d.id);
  const n = docIds.length;
  const dim = n > 0 ? embeddings.get(docIds[0])!.length : 0;
  const flat = new Float32Array(n * dim);
  for (let i = 0; i < n; i++) {
    const v = embeddings.get(docIds[i])!;
    let mag = 0;
    for (let d = 0; d < dim; d++) mag += v[d] * v[d];
    mag = Math.sqrt(mag) || 1;
    const off = i * dim;
    for (let d = 0; d < dim; d++) flat[off + d] = v[d] / mag;
  }

  const neighbors: Array<Array<{ peer: number; sim: number }>> = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const oi = i * dim;
    for (let j = i + 1; j < n; j++) {
      const oj = j * dim;
      let sim = 0;
      for (let d = 0; d < dim; d++) sim += flat[oi + d] * flat[oj + d];
      if (sim >= edgeThreshold) {
        neighbors[i].push({ peer: j, sim });
        neighbors[j].push({ peer: i, sim });
      }
    }
  }

  for (let i = 0; i < n; i++) {
    neighbors[i].sort((a, b) => b.sim - a.sim);
    for (const { peer: j, sim } of neighbors[i].slice(0, maxEdgesPerNode)) {
      const edgeKey = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (!edgeCounts.has(edgeKey)) {
        edges.push({ source: docIds[i], target: docIds[j], weight: sim });
        edgeCounts.set(edgeKey, 1);
      }
    }
  }

  // 3. 클러스터링 — 모드에 따라 분기
  const mode = options.mode ?? 'semantic';
  let assignmentMap: Map<string, number>;
  let clusters: Cluster[];

  if (mode === 'folder') {
    // 폴더 기반: 최상위 폴더를 클러스터로 사용
    const folderMap = new Map<string, number>();
    const folderNames: string[] = [];

    for (const doc of docs) {
      const topFolder = doc.filePath.split('/')[0] ?? 'root';
      if (!folderMap.has(topFolder)) {
        folderMap.set(topFolder, folderNames.length);
        folderNames.push(topFolder);
      }
    }

    assignmentMap = new Map<string, number>();
    for (const doc of docs) {
      const topFolder = doc.filePath.split('/')[0] ?? 'root';
      assignmentMap.set(doc.id, folderMap.get(topFolder)!);
    }

    // 폴더별 클러스터
    const folderCounts = new Map<number, number>();
    for (const [, cId] of assignmentMap) {
      folderCounts.set(cId, (folderCounts.get(cId) ?? 0) + 1);
    }

    clusters = folderNames.map((name, i) => ({
      id: i,
      label: name.replace(/^\d+_/, ''),  // "04_Projects" → "Projects"
      color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
      nodeCount: folderCounts.get(i) ?? 0,
    }));
  } else {
    // 시맨틱 기반: K-means over the SAME capped, recency-ranked set as the edge loop
    // (docsWithVecs) so clustering is bounded too. maxIter 50→15 (converges well before).
    const clusterIds = docIds; // identical order to `flat` (the normalized vectors)
    // clusterCount > 0 overrides the auto heuristic — the cluster-first LOD path asks
    // for many more communities (≈40–80) than the default ≤10.
    const k = (options.clusterCount && options.clusterCount > 0)
      ? Math.floor(options.clusterCount)
      : Math.min(Math.max(5, Math.round(Math.sqrt(clusterIds.length / 5))), 10);
    const assignments = kMeans(flat, n, dim, Math.min(k, clusterIds.length || 1), 10);

    // 클러스터별 문서 수집 (id + title) — Map lookup, not O(docs²) docs.find
    const docById = new Map(docsWithVecs.map(d => [d.id, d] as const));
    const clusterDocInfos = new Map<number, Array<{ id: string; title: string }>>();
    for (let i = 0; i < clusterIds.length; i++) {
      const cId = assignments[i];
      if (!clusterDocInfos.has(cId)) clusterDocInfos.set(cId, []);
      const doc = docById.get(clusterIds[i]);
      if (doc) clusterDocInfos.get(cId)!.push({ id: doc.id, title: doc.title });
    }

    // 엣지 기반 연결 수 계산 (대표 노드 선정용)
    const connCounts = new Map<string, number>();
    for (const e of edges) {
      connCounts.set(e.source, (connCounts.get(e.source) ?? 0) + 1);
      connCounts.set(e.target, (connCounts.get(e.target) ?? 0) + 1);
    }

    clusters = [];
    for (const [cId, docInfos] of clusterDocInfos) {
      // 가장 연결이 많은 노드 = 대표 노드
      const sorted = [...docInfos].sort((a, b) =>
        (connCounts.get(b.id) ?? 0) - (connCounts.get(a.id) ?? 0)
      );
      const representative = sorted[0]?.title ?? 'Cluster';
      clusters.push({
        id: cId,
        label: `${representative} (${docInfos.length})`,
        color: CLUSTER_COLORS[cId % CLUSTER_COLORS.length],
        nodeCount: docInfos.length,
      });
    }

    assignmentMap = new Map<string, number>();
    for (let i = 0; i < clusterIds.length; i++) {
      assignmentMap.set(clusterIds[i], assignments[i]);
    }
  }

  // 4. 노드 생성

  const connectionCounts = new Map<string, number>();
  for (const edge of edges) {
    connectionCounts.set(edge.source, (connectionCounts.get(edge.source) ?? 0) + 1);
    connectionCounts.set(edge.target, (connectionCounts.get(edge.target) ?? 0) + 1);
  }
  const maxConnections = Math.max(1, ...connectionCounts.values());

  const nodes: GraphNode[] = docsWithVecs.map(doc => {
    const conns = connectionCounts.get(doc.id) ?? 0;
    const ratio = conns / maxConnections; // 0~1
    // 지수 스케일: 상위 노드만 극적으로 커짐 (ratio^0.5 → 중심부 강조)
    const size = 1 + 6 * Math.pow(ratio, 0.5);
    return {
      id: doc.id,
      label: doc.title.replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s*-\s*YouTube$/, '').slice(0, 40),
      filePath: doc.filePath,
      tags: doc.tags,
      clusterId: assignmentMap.get(doc.id) ?? 0,
      size,
      source: doc.source ?? 'local',
      type: doc.type ?? 'note',
      lastModified: doc.lastModified,
    };
  });

  // 5. cache key
  const cacheKey = createHash('md5')
    .update(JSON.stringify({ nodeCount: nodes.length, edgeCount: edges.length }))
    .digest('hex')
    .slice(0, 8);

  return {
    nodes,
    edges,
    clusters,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      clusterCount: clusters.length,
    },
  };
}

// ─── Wave 1: cluster-first LOD (docs/02-design/graph-scale-lod-redesign.md) ───

export interface BuildClusteredOptions {
  mode?: GraphMode;
  /** Max notes folded into the galaxy (default 3000, env GRAPH_CLUSTER_CAP). */
  clusterCap?: number;
  /** # of super-nodes (default ≈sqrt(cap/2.5), capped 80). */
  clusterCount?: number;
  edgeThreshold?: number;
  maxEdgesPerNode?: number;
}

export interface ClusteredGraph {
  clusterLevel: ClusterLevelGraph;
  /** clusterId → members payload (served by graph:expand-cluster). */
  members: Map<number, ClusterMembersGraph>;
}

/**
 * Build the tiered cluster-first graph: a small set of cluster "super-nodes" for the
 * first paint, plus a per-cluster member map streamed on drill-in. Reuses the optimized
 * buildGraphData (scoped embedding load + flat edge loop + inline k-means) with a higher
 * node cap and more clusters, then aggregates the result.
 */
export async function buildClusteredGraph(
  store: VectorStore,
  options: BuildClusteredOptions = {},
): Promise<ClusteredGraph> {
  const mode = options.mode ?? 'semantic';
  const clusterCap = Math.max(200, Math.floor(options.clusterCap ?? (Number(process.env.GRAPH_CLUSTER_CAP) || 3000)));
  const clusterCount = Math.max(1, Math.floor(
    options.clusterCount ?? Math.min(80, Math.max(6, Math.round(Math.sqrt(clusterCap / 2.5)))),
  ));

  const data = await buildGraphData(store, {
    mode, nodeCap: clusterCap, clusterCount,
    edgeThreshold: options.edgeThreshold, maxEdgesPerNode: options.maxEdgesPerNode,
  });

  // node → cluster, and member lists per cluster.
  const nodeCluster = new Map<string, number>();
  const byCluster = new Map<number, GraphNode[]>();
  for (const node of data.nodes) {
    const cid = node.clusterId ?? 0;
    nodeCluster.set(node.id, cid);
    (byCluster.get(cid) ?? byCluster.set(cid, []).get(cid)!).push(node);
  }

  // Connection degree → representative selection + super-node size.
  const degree = new Map<string, number>();
  for (const e of data.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  // Split edges into intra-cluster vs rolled-up meta-edges.
  const intraByCluster = new Map<number, GraphEdge[]>();
  const metaMap = new Map<string, MetaEdge>();
  for (const e of data.edges) {
    const ca = nodeCluster.get(e.source), cb = nodeCluster.get(e.target);
    if (ca == null || cb == null) continue;
    if (ca === cb) {
      (intraByCluster.get(ca) ?? intraByCluster.set(ca, []).get(ca)!).push(e);
    } else {
      const lo = Math.min(ca, cb), hi = Math.max(ca, cb);
      const key = `${lo}:${hi}`;
      const m = metaMap.get(key);
      if (m) { m.weight += e.weight; m.count += 1; }
      else metaMap.set(key, { sourceCluster: lo, targetCluster: hi, weight: e.weight, count: 1 });
    }
  }

  const clusterLabel = new Map<number, string>();
  for (const c of data.clusters) clusterLabel.set(c.id, c.label);

  const superNodes: ClusterSuperNode[] = [];
  for (const [cid, mem] of byCluster) {
    let rep = mem[0], repDeg = -1;
    for (const m of mem) {
      const d = degree.get(m.id) ?? 0;
      if (d > repDeg) { repDeg = d; rep = m; }
    }
    superNodes.push({
      clusterId: cid,
      // strip buildGraphData's trailing " (N)" — memberCount is a separate field.
      label: (clusterLabel.get(cid) ?? `Cluster ${cid + 1}`).replace(/\s*\(\d+\)\s*$/, ''),
      color: CLUSTER_COLORS[cid % CLUSTER_COLORS.length],
      memberCount: mem.length,
      position: [0, 0, 0], // assigned below by Fibonacci rank
      size: 2 + Math.min(12, Math.sqrt(mem.length)),
      representativeId: rep?.id ?? '',
    });
  }
  superNodes.sort((a, b) => b.memberCount - a.memberCount);
  // Semantic galaxy layout: a short force-settle of JUST the super-nodes places CONNECTED
  // clusters NEAR each other → short, non-crossing meta-edges. Fibonacci alone is evenly
  // spread but semantic-blind (related clusters can land on opposite poles → long crossing
  // chords = the "messy" look). Seeded from Fibonacci for determinism; the renderer freezes
  // the live sim for the galaxy so this precomputed layout stays put.
  layoutSuperNodes(superNodes, metaMap);

  // Per-cluster member payloads for graph:expand-cluster.
  const members = new Map<number, ClusterMembersGraph>();
  for (const [cid, mem] of byCluster) {
    const boundaryEdges: ClusterMembersGraph['boundaryEdges'] = [];
    for (const e of data.edges) {
      const ca = nodeCluster.get(e.source), cb = nodeCluster.get(e.target);
      if (ca === cid && cb !== cid && cb != null) boundaryEdges.push({ source: e.source, targetCluster: cb, weight: e.weight });
      else if (cb === cid && ca !== cid && ca != null) boundaryEdges.push({ source: e.target, targetCluster: ca, weight: e.weight });
    }
    members.set(cid, { clusterId: cid, members: mem, intraEdges: intraByCluster.get(cid) ?? [], boundaryEdges });
  }

  // Declutter the galaxy: every-cluster-↔-every-other is a hairball. Keep only each
  // cluster's 2 strongest meta-edges → a clean skeleton. With the semantic layout above
  // these connect NEARBY clusters, so the kept edges are short and barely cross.
  const META_PER_CLUSTER = 2;
  const metaByCluster = new Map<number, MetaEdge[]>();
  for (const m of metaMap.values()) {
    (metaByCluster.get(m.sourceCluster) ?? metaByCluster.set(m.sourceCluster, []).get(m.sourceCluster)!).push(m);
    (metaByCluster.get(m.targetCluster) ?? metaByCluster.set(m.targetCluster, []).get(m.targetCluster)!).push(m);
  }
  const keptMeta = new Set<MetaEdge>();
  for (const list of metaByCluster.values()) {
    list.sort((a, b) => b.weight - a.weight);
    for (const m of list.slice(0, META_PER_CLUSTER)) keptMeta.add(m);
  }

  return {
    clusterLevel: {
      level: 'galaxy',
      superNodes,
      metaEdges: [...keptMeta],
      totalNodes: data.nodes.length,
      totalEdges: data.edges.length,
      layoutVersion: mode,
    },
    members,
  };
}

// Evenly-spaced point i of n on a sphere (Fibonacci lattice) — deterministic, no clumping.
function fibonacciSphere(i: number, n: number, radius: number): [number, number, number] {
  const phi = Math.acos(1 - (2 * (i + 0.5)) / Math.max(1, n));
  const theta = Math.PI * (1 + Math.sqrt(5)) * i; // golden angle
  return [
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
  ];
}

// Galaxy super-node layout. A short, deterministic 3D force-settle of the (tiny, ≤~40)
// super-node set so CONNECTED clusters sit NEAR each other and their meta-edges stay short
// and barely cross. Seeded from a Fibonacci sphere (deterministic, well-spread start →
// stable result, no Math.random) then recentred + scaled to a fixed radius so the galaxy
// is always a consistent size regardless of force tuning. n is small so the O(n²) all-pairs
// repulsion over ~600 iters is sub-millisecond.
function layoutSuperNodes(superNodes: ClusterSuperNode[], metaMap: Map<string, MetaEdge>): void {
  const n = superNodes.length;
  if (n === 0) return;
  if (n === 1) { superNodes[0].position = [0, 0, 0]; return; }

  const idx = new Map<number, number>();
  superNodes.forEach((s, i) => idx.set(s.clusterId, i));
  const links: Array<[number, number, number]> = [];
  let maxW = 0;
  for (const m of metaMap.values()) {
    const a = idx.get(m.sourceCluster), b = idx.get(m.targetCluster);
    if (a == null || b == null || a === b) continue;
    links.push([a, b, m.weight]);
    if (m.weight > maxW) maxW = m.weight;
  }
  const wn = maxW > 0 ? 1 / maxW : 1; // normalize weights to 0..1

  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = fibonacciSphere(i, n, 100);
    pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
  }

  const REST = 42, CHARGE = 900, ITERS = 600, DAMP = 0.9, CENTER = 0.012;
  for (let it = 0; it < ITERS; it++) {
    const alpha = 1 - it / ITERS; // linear cool to 0
    // Repulsion — all pairs (n is tiny).
    for (let i = 0; i < n; i++) {
      const ix = pos[i * 3], iy = pos[i * 3 + 1], iz = pos[i * 3 + 2];
      for (let j = i + 1; j < n; j++) {
        let dx = pos[j * 3] - ix, dy = pos[j * 3 + 1] - iy, dz = pos[j * 3 + 2] - iz;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.01) { dx = ((i - j) % 3) * 0.1 || 0.1; dy = 0.1; dz = 0.1; d2 = dx * dx + dy * dy + dz * dz; }
        const f = (CHARGE * alpha) / d2;
        const fx = dx * f, fy = dy * f, fz = dz * f;
        vel[i * 3] -= fx; vel[i * 3 + 1] -= fy; vel[i * 3 + 2] -= fz;
        vel[j * 3] += fx; vel[j * 3 + 1] += fy; vel[j * 3 + 2] += fz;
      }
    }
    // Link springs — pull connected clusters toward REST (heavier links pull harder).
    for (const [a, b, w] of links) {
      let dx = pos[b * 3] - pos[a * 3], dy = pos[b * 3 + 1] - pos[a * 3 + 1], dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      const strength = 0.6 * (0.3 + 0.7 * w * wn);
      const f = ((dist - REST) / dist) * alpha * strength;
      const fx = dx * f, fy = dy * f, fz = dz * f;
      vel[a * 3] += fx; vel[a * 3 + 1] += fy; vel[a * 3 + 2] += fz;
      vel[b * 3] -= fx; vel[b * 3 + 1] -= fy; vel[b * 3 + 2] -= fz;
    }
    // Centering + integrate (damp, velocity cap, move).
    for (let i = 0; i < n; i++) {
      vel[i * 3] -= pos[i * 3] * CENTER * alpha;
      vel[i * 3 + 1] -= pos[i * 3 + 1] * CENTER * alpha;
      vel[i * 3 + 2] -= pos[i * 3 + 2] * CENTER * alpha;
      let vx = vel[i * 3] * DAMP, vy = vel[i * 3 + 1] * DAMP, vz = vel[i * 3 + 2] * DAMP;
      const sp2 = vx * vx + vy * vy + vz * vz;
      if (sp2 > 64) { const k = 8 / Math.sqrt(sp2); vx *= k; vy *= k; vz *= k; }
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      pos[i * 3] += vx; pos[i * 3 + 1] += vy; pos[i * 3 + 2] += vz;
    }
  }

  // Recenter to centroid, then scale so the furthest node sits at a fixed radius.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 3] - cx, dy = pos[i * 3 + 1] - cy, dz = pos[i * 3 + 2] - cz;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r > maxR) maxR = r;
  }
  const scale = maxR > 1 ? 125 / maxR : 1;
  for (let i = 0; i < n; i++) {
    superNodes[i].position = [
      (pos[i * 3] - cx) * scale,
      (pos[i * 3 + 1] - cy) * scale,
      (pos[i * 3 + 2] - cz) * scale,
    ];
  }
}

// --- 유틸리티 ---

// Imported from shared utils — see utils/math.ts

// Spherical k-means over a contiguous Float32Array of UNIT-normalized vectors —
// inline squared-distance (no euclideanDist call, no sqrt, no number[][] indirection).
// ~10× faster than the old number[][] version on 1.5k×384 (≈4s → sub-second).
function kMeans(flat: Float32Array, n: number, dims: number, k: number, maxIter = 50): number[] {
  if (n === 0 || dims === 0) return [];
  k = Math.max(1, Math.min(k, n));
  const centroids = new Float32Array(k * dims);

  // k-means++ init, carrying the running min-distance so each step only measures
  // against the newest centroid (O(n·k) total, not O(n·k²)).
  centroids.set(flat.subarray(0, dims), 0); // seed (data order is already shuffled by recency)
  const minDist = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    const ocPrev = (c - 1) * dims;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const oi = i * dims;
      let d = 0;
      for (let z = 0; z < dims; z++) { const diff = flat[oi + z] - centroids[ocPrev + z]; d += diff * diff; }
      if (d < minDist[i]) minDist[i] = d;
      total += minDist[i];
    }
    let r = Math.random() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) { r -= minDist[i]; if (r <= 0) { pick = i; break; } }
    centroids.set(flat.subarray(pick * dims, pick * dims + dims), c * dims);
  }

  const assignments = new Array<number>(n).fill(0);
  const sums = new Float64Array(k * dims);
  const counts = new Uint32Array(k);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const oi = i * dims;
      let bestC = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const oc = c * dims;
        let d = 0;
        for (let z = 0; z < dims; z++) { const diff = flat[oi + z] - centroids[oc + z]; d += diff * diff; }
        if (d < bestD) { bestD = d; bestC = c; }
      }
      if (assignments[i] !== bestC) { assignments[i] = bestC; changed = true; }
    }
    if (!changed) break;
    sums.fill(0); counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i]; counts[c]++;
      const oi = i * dims, oc = c * dims;
      for (let z = 0; z < dims; z++) sums[oc + z] += flat[oi + z];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      const oc = c * dims;
      for (let z = 0; z < dims; z++) centroids[oc + z] = sums[oc + z] / counts[c];
    }
  }
  return assignments;
}

// euclideanDist imported from shared utils

function extractClusterLabel(titles: string[]): string {
  // 제목에서 빈출 단어 추출 (2글자 이상)
  const wordCounts = new Map<string, number>();
  const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was', 'be']);
  for (const title of titles) {
    const words = title.replace(/[^\w가-힣\s]/g, '').split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w.toLowerCase()));
    const seen = new Set<string>();
    for (const w of words) {
      if (!seen.has(w)) { wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1); seen.add(w); }
    }
  }
  const sorted = [...wordCounts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 3).map(([w]) => w).join(', ') || `Cluster`;
}
