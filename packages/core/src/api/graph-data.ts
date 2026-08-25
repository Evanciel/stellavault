// Design Ref: §4.2 — Graph Data 생성 알고리즘
// Design Ref: §6.2 — K-Means 클러스터링

import type { VectorStore } from '../store/types.js';
import type {
  GraphNode, GraphEdge, Cluster, GraphData,
  ClusterSuperNode, MetaEdge, ClusterLevelGraph, ClusterMembersGraph,
} from '../types/graph.js';
import { createHash } from 'node:crypto';
import { shouldParallelize, allocPackedVectors, computeTopKEdgesParallel } from '../parallel/pool.js';

// Renderer-aligned cluster palette — the SINGLE source for every `color` this module emits.
// The web renderer derives a node's DOT color from PALETTE[clusterId % PALETTE.length]
// (packages/graph/src/components/GraphNodes.tsx), which is this same literal parsed to RGB.
// Keep the two byte-identical; `npm run check:palette` fails if they drift.
//
// There used to be a SECOND array (CLUSTER_COLORS) in a DIFFERENT order feeding
// clusters[].color and superNodes[].color, while the renderer drew dots from PALETTE_HEX →
// in the raw view every ClusterFilter swatch showed a different color than the dots it
// filtered. One array, one `paletteHex()`, no divergence.
//
// 80 entries = the cluster ceiling in buildClusteredGraph (`Math.min(80, …)`). At the old 15
// the default ~35-cluster galaxy wrapped, so ~2.3 unrelated planets shared each color and
// "same color = same group" — the entire point of the view — was false.
const PALETTE_HEX = [
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
function paletteHex(clusterId: number): string {
  return PALETTE_HEX[((clusterId % PALETTE_HEX.length) + PALETTE_HEX.length) % PALETTE_HEX.length];
}

export type GraphMode = 'semantic' | 'folder';

/** Bucket for notes sitting directly in the vault root (no folder above them). */
const ROOT_FOLDER = '(root)';
/** Bucket the long tail of small folders folds into once the cluster cap is hit. */
const OTHER_FOLDER = '(other)';

/**
 * Vault-relative path → its top-level folder name.
 *
 * The old inline form was `filePath.split('/')[0] ?? 'root'`, whose `??` is DEAD — split()
 * always yields at least one element. A root-level note therefore returned its own FILE NAME
 * as the folder, so every root note became a one-note "planet" labelled e.g. "Projects.md".
 */
function topFolderOf(filePath: string): string {
  const i = filePath.indexOf('/');
  return i > 0 ? filePath.slice(0, i) : ROOT_FOLDER;
}

/**
 * Coarse build progress. Emitted from the phases that actually take wall-clock time, so a
 * caller (the /api/graph/status route) can answer "is it stuck or is it working?" while the
 * edge pass runs in worker threads and the event loop is free.
 */
export interface GraphBuildProgress {
  phase: 'loading' | 'edges' | 'clustering' | 'assembling' | 'done';
  done: number;
  total: number;
}

export interface BuildGraphOptions {
  mode?: GraphMode;            // default: 'semantic'
  edgeThreshold?: number;      // default: 0.15
  maxEdgesPerNode?: number;    // default: 5
  clusterCount?: number;       // 0 = auto (Elbow)
  nodeCap?: number;            // max notes fed into the O(n²) edge/cluster pass (default 2000)
  onProgress?: (p: GraphBuildProgress) => void;
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
    onProgress,
  } = options;
  onProgress?.({ phase: 'loading', done: 0, total: 0 });

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
  // GRAPH_NODE_CAP 은 raw/"All nodes" 뷰의 상한이다.
  //
  // 예전 기본값 1500 은 CPU 때문이었다: 아래 all-pairs 코사인이 Express 이벤트 루프를 통째로
  // 물고 있어서, 전량(17,303)은 실측 101.5초 동안 서버가 아무 요청도 못 받았다. 그 제약이
  // 사라졌다 — 엣지 패스는 worker_threads 로 나갔고(parallel/pool.ts) 메인 스레드는 놀고 있다.
  //
  // 실볼트 실측(17,339 노드): 직렬 78.9s → 병렬 27.6s, 엣지 72,710개가 바이트 단위로 동일
  // (근사 없음). 힙 130MB. 그래서 기본값을 전량으로 올린다 — 볼트의 83%가 안 보이던 쪽이
  // 27초 콜드 빌드(5분 캐시 + /api/graph/status 진행률)보다 나쁜 기본값이었다.
  // 느린 장비에서 되돌리려면 GRAPH_NODE_CAP 으로 낮춘다.
  const NODE_CAP = Math.max(200, Math.floor(options.nodeCap ?? (Number(process.env.GRAPH_NODE_CAP) || 20000)));
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
  // Decided BEFORE packing: the worker pool can only SHARE (rather than deep-copy per worker)
  // a SharedArrayBuffer-backed array, and a SAB is pointless when we are going to run serially.
  // Every downstream reader (edge loop, kMeans) treats the two backings identically.
  const wantParallel = shouldParallelize(n);
  const flat = allocPackedVectors(n * dim, wantParallel);
  for (let i = 0; i < n; i++) {
    const v = embeddings.get(docIds[i])!;
    let mag = 0;
    for (let d = 0; d < dim; d++) mag += v[d] * v[d];
    mag = Math.sqrt(mag) || 1;
    const off = i * dim;
    for (let d = 0; d < dim; d++) flat[off + d] = v[d] / mag;
  }

  // Bounded top-K per node, in FIXED typed-array slots.
  //
  // This loop used to push a {peer, sim} object for EVERY pair over the threshold into a
  // per-node array, then sort and slice to maxEdgesPerNode. Only K survived, but all of them
  // were built and held first — so peak memory grew with the PAIR count, i.e. O(n²):
  //
  //     n=3,000  →   3.18M pairs →  234 MB      (measured)
  //     n=6,000  →  13.1M  pairs →  937 MB      (measured)
  //     n=17,303 → ~109M   pairs → ~7.8 GB      (extrapolated → OOM)
  //
  // That is what GRAPH_NODE_CAP was really protecting against — not CPU. Keeping only each
  // node's current top-K makes memory O(n·k) (~84 MB at the full 17k vault, measured linear),
  // and drops the giant per-node sorts (~20% faster as a side effect).
  //
  // The resulting edge set is defined exactly as before — "each node's K strongest neighbours
  // above the threshold" — so this is a memory fix, not a behaviour change. Only the tie-break
  // order among equal similarities can differ.
  const K = Math.max(1, maxEdgesPerNode);
  const bestSim = new Float32Array(n * K).fill(-1);
  const bestPeer = new Int32Array(n * K).fill(-1);

  // Replace the node's weakest kept neighbour if this one beats it. K is small (default 5),
  // so the linear scan for the weakest slot is cheaper than maintaining a heap.
  const offer = (node: number, peer: number, sim: number): void => {
    const base = node * K;
    let worst = 0;
    for (let t = 1; t < K; t++) if (bestSim[base + t] < bestSim[base + worst]) worst = t;
    if (sim > bestSim[base + worst]) {
      bestSim[base + worst] = sim;
      bestPeer[base + worst] = peer;
    }
  };

  // Try the worker pool first. It computes the SAME slots — see parallel/worker-source.ts for
  // why row-range × full-j scan reproduces the serial offer order exactly (bit-for-bit, not
  // just "equivalent"), which is what lets us keep the byte-identical-edge-set property the
  // serial top-K rewrite was validated against at n=999 and n=2999 on real vault data.
  //
  // Measured serial cost at the full 17,303-doc vault: 101,527 ms. That number, not memory,
  // is what GRAPH_NODE_CAP is now protecting against.
  //
  // It returns false instead of throwing on ANY failure (kill switch, small n, spawn refused,
  // worker death, watchdog) — a graph build must never fail because thread spawning did — so
  // the slots are reset and the serial loop below runs unchanged.
  let parallelDone = false;
  if (wantParallel) {
    onProgress?.({ phase: 'edges', done: 0, total: n });
    parallelDone = await computeTopKEdgesParallel({
      flat, n, dim, K, threshold: edgeThreshold, bestSim, bestPeer,
      onProgress: (rowsDone) => onProgress?.({ phase: 'edges', done: rowsDone, total: n }),
    });
    if (!parallelDone) {
      // A failed run can have merged some blocks already; the serial loop only ever REPLACES
      // a weaker slot, so leftover values would survive and corrupt the result.
      bestSim.fill(-1);
      bestPeer.fill(-1);
    }
  }

  if (!parallelDone) {
    onProgress?.({ phase: 'edges', done: 0, total: n });
    for (let i = 0; i < n; i++) {
      const oi = i * dim;
      for (let j = i + 1; j < n; j++) {
        const oj = j * dim;
        let sim = 0;
        for (let d = 0; d < dim; d++) sim += flat[oi + d] * flat[oj + d];
        if (sim >= edgeThreshold) {
          offer(i, j, sim);
          offer(j, i, sim);
        }
      }
    }
    onProgress?.({ phase: 'edges', done: n, total: n });
  }

  const edgeIndexByKey = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const base = i * K;
    for (let t = 0; t < K; t++) {
      const j = bestPeer[base + t];
      if (j < 0) continue;
      const edgeKey = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (!edgeCounts.has(edgeKey)) {
        edgeIndexByKey.set(edgeKey, edges.length);
        edges.push({ source: docIds[i], target: docIds[j], weight: bestSim[base + t] });
        edgeCounts.set(edgeKey, 1);
      }
    }
  }

  // 2b. 사용자가 직접 쓴 [[위키링크]] 를 엣지로 합친다.
  //
  // 위의 k-NN 엣지는 "모델이 비슷하다고 본" 추론이고, 이건 "사람이 직접 그은" 사실이다.
  // 두 계층을 한 화면에서 구분해 보여주는 것이 이 그래프가 Obsidian 그래프뷰와 다른 지점이라
  // 링크는 별도 kind 로 실어 보낸다(렌더러가 색/알파/방향 테이퍼로 구분).
  //
  // 실측(사용자 볼트 17,642 노트): 위키링크는 505 파일에 2,622개뿐이다 — 97%의 노트에는
  // 손으로 그은 연결이 하나도 없다. 그래서 "링크만" 그리면 거의 빈 화면이 되고, 링크만
  // 빼면 사람이 남긴 유일한 명시적 구조를 버리게 된다. 둘 다 필요하다.
  onProgress?.({ phase: 'edges', done: n, total: n });
  try {
    const indexOfDoc = new Map<string, number>();
    for (let i = 0; i < n; i++) indexOfDoc.set(docIds[i], i);

    // 링크는 maxEdgesPerNode 를 받지 않는다 — 그 상한은 O(n²) 코사인이 만드는 거미줄을
    // 묶어두려고 있는 것이지, 사실을 버리라는 뜻이 아니다. 대신 병적인 볼트(자동생성 MOC 가
    // 수만 링크를 뿜는 경우)에 대비해 전체 상한만 둔다. 문서당 상한은 파서 쪽(1000)에 이미 있다.
    const LINK_EDGE_CAP = 50_000;
    let linkEdges = 0;
    let droppedByCap = 0;

    for (const pair of await store.getLinkPairs()) {
      const i = indexOfDoc.get(pair.sourceDocId);
      const j = indexOfDoc.get(pair.targetDocId);
      // 캡(nodeCap) 때문에 렌더 대상이 아닌 노트로 가는 링크는 그릴 자리가 없다.
      if (i === undefined || j === undefined || i === j) continue;
      if (linkEdges >= LINK_EDGE_CAP) { droppedByCap++; continue; }

      const edgeKey = i < j ? `${i}:${j}` : `${j}:${i}`;
      const existing = edgeIndexByKey.get(edgeKey);
      if (existing !== undefined) {
        // 같은 쌍이 이미 시맨틱 엣지로 있으면 링크가 이긴다: 사실이 추론을 덮는다.
        // 방향도 링크 쪽(source→target)으로 맞춘다 — 시맨틱은 무방향이라 잃을 것이 없다.
        const e = edges[existing];
        if (e.kind !== 'link') {
          e.source = pair.sourceDocId;
          e.target = pair.targetDocId;
          e.kind = 'link';
          e.weight = 1; // 승격된 엣지도 링크다 — 아래 신규 링크와 같은 weight 규약을 따른다
          linkEdges++;
        }
        continue;
      }
      edgeIndexByKey.set(edgeKey, edges.length);
      edgeCounts.set(edgeKey, 1);
      // weight 는 렌더러에서 시맨틱 엣지의 알파 감쇠에만 쓰인다. 링크는 유사도가 아니라
      // 사실이므로 1(최대)로 둔다 — 감쇠 대상이 아니다. (위 승격 경로도 동일하게 1로 덮는다:
      // 코사인 값을 남겨두면 kind='link' 엣지끼리 weight 가 제각각이 된다.)
      edges.push({ source: pair.sourceDocId, target: pair.targetDocId, weight: 1, kind: 'link' });
      linkEdges++;
    }
    if (droppedByCap > 0) {
      console.warn(`[graph] link edges capped at ${LINK_EDGE_CAP}; ${droppedByCap} dropped`);
    }
  } catch (err) {
    // links 테이블이 없는 예전 DB이거나 해석이 실패해도 그래프 자체는 나와야 한다.
    // 시맨틱 엣지만으로도 화면은 성립한다.
    console.warn('[graph] link edges unavailable, semantic edges only:', (err as Error)?.message ?? err);
  }

  // 3. 클러스터링 — 모드에 따라 분기
  onProgress?.({ phase: 'clustering', done: 0, total: n });
  const mode = options.mode ?? 'semantic';
  let assignmentMap: Map<string, number>;
  let clusters: Cluster[];

  if (mode === 'folder') {
    // 폴더 기반: 최상위 폴더를 클러스터로 사용.
    //
    // 집계 대상은 반드시 docsWithVecs — 실제로 노드가 되는, 캡이 적용된 집합이다. 예전에는
    // docs(볼트 전체)를 훑어서 두 가지가 어긋났다: (a) 화면에 노드가 0개인 폴더까지
    // clusters[] 에 남아 raw 뷰 ClusterFilter 에 유령 항목이 뜨고, (b) nodeCount 가 렌더된
    // 노드 수가 아니라 볼트 전체 노트 수를 세어 UI 숫자가 실제 화면과 달랐다.
    const folderIds = new Map<string, number>();
    let names: string[] = [];
    let counts: number[] = [];
    const perDoc: Array<{ id: string; cId: number }> = [];

    for (const doc of docsWithVecs) {
      const folder = topFolderOf(doc.filePath);
      let cId = folderIds.get(folder);
      if (cId === undefined) {
        cId = names.length;
        folderIds.set(folder, cId);
        names.push(folder);
        counts.push(0);
      }
      counts[cId]++;
      perDoc.push({ id: doc.id, cId });
    }

    // 폴더 수 상한. semantic 분기는 clusterCount 를 지키는데 folder 분기는 통째로 무시해서,
    // 최상위 폴더가 많은 볼트는 은하가 폴더 개수만큼 행성으로 터졌다(팔레트 소진 · 라벨 뭉개짐
    // · layoutSuperNodes 비용 증가). 큰 폴더 상위 (k-1) 개만 남기고 롱테일은 '(other)' 하나로
    // 접는다. clusterCount 미지정(raw 뷰)이면 상한 없음 — 종전 동작 그대로.
    const k = options.clusterCount && options.clusterCount > 0 ? Math.floor(options.clusterCount) : 0;
    let remap: number[] | null = null;
    if (k > 0 && names.length > k) {
      const order = names.map((_, i) => i).sort((a, b) => counts[b] - counts[a]);
      remap = new Array<number>(names.length);
      const keptNames: string[] = [];
      const keptCounts: number[] = [];
      for (const oldId of order.slice(0, k - 1)) {
        remap[oldId] = keptNames.length;
        keptNames.push(names[oldId]);
        keptCounts.push(counts[oldId]);
      }
      const otherId = keptNames.length;
      let otherCount = 0;
      let folded = 0;
      for (const oldId of order.slice(k - 1)) {
        remap[oldId] = otherId;
        otherCount += counts[oldId];
        folded++;
      }
      keptNames.push(`${OTHER_FOLDER} (${folded})`);
      keptCounts.push(otherCount);
      names = keptNames;
      counts = keptCounts;
    }

    assignmentMap = new Map<string, number>();
    for (const { id, cId } of perDoc) assignmentMap.set(id, remap ? remap[cId] : cId);

    clusters = names.map((name, i) => ({
      id: i,
      label: name.replace(/^\d+_/, ''),  // "04_Projects" → "Projects"
      color: paletteHex(i),
      nodeCount: counts[i] ?? 0,
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
        color: paletteHex(cId),
        nodeCount: docInfos.length,
      });
    }

    assignmentMap = new Map<string, number>();
    for (let i = 0; i < clusterIds.length; i++) {
      assignmentMap.set(clusterIds[i], assignments[i]);
    }
  }

  // 4. 노드 생성
  onProgress?.({ phase: 'assembling', done: 0, total: n });

  const connectionCounts = new Map<string, number>();
  for (const edge of edges) {
    connectionCounts.set(edge.source, (connectionCounts.get(edge.source) ?? 0) + 1);
    connectionCounts.set(edge.target, (connectionCounts.get(edge.target) ?? 0) + 1);
  }
  // Reduce, don't spread: `Math.max(1, ...values)` passes one ARGUMENT per node, which throws
  // RangeError once GRAPH_NODE_CAP is raised past the engine's argument limit (~65k).
  let maxConnections = 1;
  for (const c of connectionCounts.values()) if (c > maxConnections) maxConnections = c;

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

  onProgress?.({ phase: 'done', done: n, total: n });

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

/**
 * Flatten a galaxy ClusterLevelGraph into the same {nodes,edges,clusters,stats} GraphData
 * shape the raw graph uses, so the web viewer renders cluster super-nodes through the SAME
 * Points cloud + lineSegments path with zero renderer changes. Exported so the server route
 * AND the unit test share ONE mapping.
 *
 * - super-node → GraphNode with id `cluster:${clusterId}` (namespace is disjoint from real
 *   doc ids, so a drill-down merge never collides), isCluster/memberCount/representativeId
 *   set, and sn.position/sn.size preserved verbatim (the baked Fibonacci+force-settle galaxy
 *   layout — the viewer must NOT re-randomize these).
 * - meta-edge → GraphEdge (me.count is dropped; GraphEdge is only {source,target,weight}).
 * - clusters[].color uses paletteHex (renderer-aligned) so the ClusterFilter swatch matches
 *   the rendered dot — see the PALETTE_HEX comment above (color decision (a)).
 */
export function flattenClusterLevel(level: ClusterLevelGraph): GraphData {
  const nodes: GraphNode[] = level.superNodes.map((sn) => ({
    id: `cluster:${sn.clusterId}`,
    label: sn.label,
    filePath: '',
    tags: [],
    clusterId: sn.clusterId,
    position: sn.position,
    size: sn.size,
    source: 'cluster',
    type: 'cluster',
    isCluster: true,
    memberCount: sn.memberCount,
    representativeId: sn.representativeId,
  }));

  const edges: GraphEdge[] = level.metaEdges.map((me) => ({
    source: `cluster:${me.sourceCluster}`,
    target: `cluster:${me.targetCluster}`,
    weight: me.weight,
  }));

  const clusters: Cluster[] = level.superNodes.map((sn) => ({
    id: sn.clusterId,
    label: sn.label,
    color: paletteHex(sn.clusterId),
    nodeCount: sn.memberCount,
  }));

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
  onProgress?: (p: GraphBuildProgress) => void;
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
  // GRAPH_CLUSTER_CAP = 갤럭시로 접기 전에 클러스터링에 넣는 노트 수. buildGraphData 의
  // nodeCap 으로 그대로 내려가므로 같은 O(n²) 코사인 패스가 이 캡에서 돈다.
  //
  // 기본 3000 이었다 = 17,303 노트 볼트에서 14,303개가 갤럭시에 아예 없었다는 뜻이다. 화면은
  // "전체 지식 지도"처럼 보이는데 실제로는 최근 3천 개만 그린, 조용한 거짓말이었다. 병렬화로
  // 전량 빌드가 27.6초(실측)가 됐으므로 기본을 전량으로 올린다. 렌더는 여전히 싸다(≤80
  // 슈퍼노드) — 비싼 쪽은 빌드고, 그건 5분 캐시 + 진행률로 흡수한다.
  const clusterCap = Math.max(200, Math.floor(options.clusterCap ?? (Number(process.env.GRAPH_CLUSTER_CAP) || 20000)));
  const clusterCount = Math.max(1, Math.floor(
    options.clusterCount ?? Math.min(80, Math.max(6, Math.round(Math.sqrt(clusterCap / 2.5)))),
  ));

  const data = await buildGraphData(store, {
    mode, nodeCap: clusterCap, clusterCount,
    edgeThreshold: options.edgeThreshold, maxEdgesPerNode: options.maxEdgesPerNode,
    // The galaxy rollup below is O(nodes+edges) and sub-second; buildGraphData owns every
    // phase worth reporting, so pass the caller's sink straight through.
    onProgress: options.onProgress,
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
      color: paletteHex(cid),
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
