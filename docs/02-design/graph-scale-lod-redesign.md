# Stellavault 3D Knowledge Graph — Cluster-First LOD Redesign (v0.4.0)

> Produced by the `graph-scale-redesign` deep-research workflow (6 agents: current-state map + 4 web-research tracks + synthesis).
>
> **Goal:** Stop loading and rendering all nodes at once. Replace the "1,500 recency-capped points + always-live force sim" model with a **cluster-first, level-of-detail (LOD), expand-on-demand** architecture that opens at ~10–80 super-nodes, streams a cluster's members only when the user drills in, and scales smoothly to 12,000+ nodes (stretch 100k). Non-destructive, deep-space visual preserved, shipped in independently-testable waves behind a strict `tsc + vitest + smoke` gate.

---

## 0. Decision summary (TL;DR)

| Question | Decision |
|---|---|
| Primary approach | **Cluster-first LOD** + viewport culling + **precomputed cached layout** (force sim demoted from "always live" to a one-time bake). |
| Default view | **Cluster super-nodes only** (~`k` of them, k≈8–80), not 1,500 raw notes. |
| Drill-in | Click / zoom a super-node → **`graph:expand-cluster`** streams that cluster's members; rest of the graph stays put. |
| Layout engine | **Precomputed, deterministic, UMAP/PCA-seeded force settle**, baked in a **Web Worker**, persisted on disk keyed `mode@version@layoutAlgoVersion`. Eliminates per-open sim, central clump, and 2D-line collapse. |
| Community detection | **Leiden/Louvain** (precomputed in core at build time), replacing inline k-means. Falls back to k-means if the optional dep is unavailable. |
| Build vs adopt | **BUILD** — improve the existing R3F `THREE.Points` renderer (already GPU-instanced + 3D-native). Keep **cosmos.gl as an optional 2D "mega-graph" mode** (Wave 3, optional). |
| Frame budget | **16.6 ms/frame (60 fps)** at every LOD; **idle = 0 GPU** via `frameloop="demand"`. |

### Node-count ceilings per LOD level

| LOD | Camera state | What's drawn | Node ceiling | Edge ceiling | Sim? |
|---|---|---|---|---|---|
| **L0 — Galaxy** | Zoomed out (default) | Cluster super-nodes + meta-edges | **≤ 200** super-nodes | ≤ 600 meta-edges | none (static baked) |
| **L1 — Constellation** | One/few clusters expanded | Members of expanded clusters + edges + sibling super-nodes | **≤ 2,000** live points | ≤ 8,000 | optional short settle on first expand |
| **L2 — Star** | Zoomed into a node neighborhood | k-hop ego-graph around focus | **≤ 500** | ≤ 2,500 | none |
| **Safety hard cap** | any | total live points in scene | **6,000** | — | — |

The binding change: **the default scene goes from ≤1,500 points to ≤200 super-nodes**, and the full 12k is reachable cluster-by-cluster instead of being silently truncated to the 1,500 most-recently-edited notes.

---

## 1. Recommended architecture

**Cluster-first LOD with a cached, precomputed layout and viewport culling.** Force simulation is demoted from "ticks every frame in `useFrame`" to "baked once in a Worker, frozen, re-settled only on explicit user action."

### The three real problems (verified against the code)

1. **87% of a 12k vault is invisible** (recency-capped to 1,500 in `graph-data.ts`). → *Fixed by clustering: every note belongs to a cluster, every cluster is reachable by drill-in. Nothing is truncated; it's tiered.*
2. **The always-live force sim** (`GraphView.tsx` ticking every frame) causes the central clump and 2D-line collapse (`force-sim.ts` center-gravity + per-tick z-zero), rewrites every node + edge buffer per frame, and never permanently rests. → *Fixed by precomputing the layout once and rendering statically.*
3. **Cold build blocks the Electron main thread** (all-12k metadata + O(n²) cosine + k-means synchronously in the IPC handler). → *Fixed by computing in a Worker, persisting the bake on disk, and only sending ~200 super-nodes on first paint.*

### The model: dual-graph (master / view)

- **Master graph** = the full `{nodes, edges, clusterId per node}` — lives in core + the on-disk layout cache. Never mutated by the UI.
- **View graph** = what's in the R3F scene. Starts as **one super-node per cluster**; expanding a super-node swaps it for its member nodes; collapsing reverses it. Inter-cluster edges roll up into **weighted meta-edges**; intra-cluster edges are hidden until expanded.

### Frame & memory budget

- **60 fps / 16.6 ms** at all LODs; **`frameloop="demand"`** → a resting galaxy view costs **0 GPU/frame**.
- 100k nodes × (pos 3f + col 3f + size 1f) ≈ 2.8 MB — trivial. Edges are the memory risk at scale; cap drawn edges per LOD.

---

## 2. Data model

### 2a. New tiered API alongside `buildGraphData`, not a rewrite

Extend `buildGraphData` to emit cluster membership + (later) baked positions, add `buildClusteredGraph(store, opts)` returning the tiered structure, and two thin tiered IPC endpoints that slice it. `graph:build` stays unchanged for `GraphPanel` (back-compat).

### 2b. Core TypeScript types (`packages/core/src/types/graph.ts`)

```ts
export interface ClusterSuperNode {
  clusterId: number;
  label: string;              // TF-IDF top terms or representative title
  color: string;
  memberCount: number;
  position: [number, number, number]; // baked L0 galaxy position
  size: number;               // f(memberCount)
  representativeId: string;   // most-central member; opens on double-click
}
export interface MetaEdge {
  sourceCluster: number; targetCluster: number;
  weight: number; count: number;
}
export interface TieredGraphNode {
  id: string; label: string; filePath: string; tags: string[];
  clusterId: number; size: number;
  position: [number, number, number]; // baked
  source: string; type: string; lastModified?: string;
}
export interface ClusterLevelGraph {
  level: 'galaxy';
  superNodes: ClusterSuperNode[]; metaEdges: MetaEdge[];
  totalNodes: number; totalEdges: number; layoutVersion: string;
}
export interface ClusterMembersGraph {
  clusterId: number;
  members: TieredGraphNode[]; intraEdges: GraphEdge[];
  boundaryEdges: Array<{ source: string; targetCluster: number; weight: number }>;
}
```

### 2c. IPC channels

```ts
ipc('graph:clusters', { mode }) => Promise<ClusterLevelGraph>            // first paint (~200 super-nodes)
ipc('graph:expand-cluster', { mode, clusterId }) => Promise<ClusterMembersGraph> // drill-in (Map lookup after first build)
ipc('graph:ego', { mode, nodeId, depth }) => Promise<ClusterMembersGraph>        // L2 (Wave 2)
ipc('graph:build', mode) => { nodes, edges }                            // UNCHANGED — GraphPanel back-compat
```

The main-process `graphBuildCache` extends to hold the full `ClusterLevelGraph` + a `Map<clusterId, ClusterMembersGraph>` under `mode@version`. In-flight coalescing + `bumpGraphCacheVersion` invalidation carry over verbatim.

---

## 3. Layout — precomputed, not live

**Bake once, freeze, render static.** Persist at `~/.stellavault/graph/<vaultHash>/<layoutVersion>.bin`. On open the renderer reads baked positions — no sim on load. Kills the clump + 2D-line because there is no center-gravity loop pulling inward.

The live force sim is **retained but repurposed**: runs (a) in the Worker during the bake, and (b) on-demand for a short re-settle on expand/drag. Never ticks indefinitely in `useFrame`.

### Bake pipeline
```
embeddings (384-dim) → PCA/UMAP project to 3D (spread clusters, NO clump by construction)
                     → short bounded force settle (≈150–300 ticks) seeded FROM the projection
                     → freeze + persist
```
- **Clump fix:** seed from PCA/UMAP (clusters spread across the manifold) + short, gravity-reduced settle. The projection IS the global layout; force only polishes locally.
- **2D-line fix:** 2D uses a **separate baked 2-component projection** — no z to zero, no live gravity → nothing to pinch. 2D and 3D are two independently-baked layouts.
- **Determinism:** sort nodes by `id` (not Map order); fixed `mulberry32` seed; on reindex re-seed from previous positions (incremental stability).

---

## 4. Renderer changes (file-level)

- **`graph-core.tsx`** — raise `MAX_GLOBAL_NODES` 3000→6000; default positions from baked payload (`seededPosition` fallback); add `buildSuperNodeBuffers`/`buildMetaEdgeBuffers`; move hover/dim into the shader (uniform write, O(1), replaces the per-hover CPU loop over all nodes); activate dead `extractClusterLabel`.
- **`force-sim.ts`** — no per-frame use; expose headless `bake(maxIters)`; hub-damping (divide hub attraction by degree); bounded `forceCollide` (min-distance floor); drop per-tick z-zero.
- **`GraphView.tsx`** — `<Canvas frameloop="demand">` + `invalidate()` on pointer/animation/camera-change; initial load via `graph:clusters` (≤200 super-nodes static); LOD switch by zoom; expand on super-node click → `graph:expand-cluster` + ~400 ms burst animation (lerp via `uExpandT` uniform); per-cluster sub-`<points>` so frustum culling works (`frustumCulled` true per tile); label only super-nodes at L0, zoom-adaptive top-K within expanded clusters at L1.

**Net:** first paint = ~200 static super-nodes, no sim, no O(n²), 0 idle GPU. The 12k is fully reachable by clicking clusters.

---

## 5. Community detection — Leiden/Louvain, precomputed in core

| | k-means (current) | Leiden/Louvain (recommended) |
|---|---|---|
| Connectivity | none → clusters can be disconnected fragments | **connected communities** (coherent drill-in) |
| Count | guess `k`, caps at 10 | discovers count via resolution γ |
| Determinism | init-sensitive | reproducible w/ seed |
| Hierarchy | none | **dendrogram** → free multi-level zoom |

**MVP path:** ship `graphology-communities-louvain` (pure JS, seedable) + a connected-component split post-pass (gives Leiden's key guarantee). Optional true Leiden in Wave 3. Fall back to k-means if the dep is absent. Weight edges by cosine similarity; run on the kNN edges already computed.

---

## 6. Incremental delivery roadmap

### **Wave 1 (MVP) — Cluster-first first-paint** ← smallest change, biggest scale win
Default the graph to super-nodes; stop sending 1,500 raw points. No Worker/UMAP yet — reuse existing k-means/Louvain + on-the-fly positions.
- **Files:** `graph-data.ts` (emit clusters + meta-edges + representative; `buildClusteredGraph`), `types/graph.ts` (new types), `main/index.ts` (`graph:clusters` + `graph:expand-cluster` + cache), `preload` (allowlist), `graph-core.tsx` (`buildSuperNodeBuffers`, labels), `GraphView.tsx` (load `graph:clusters`, render super-nodes, click-to-expand, `frameloop="demand"`).
- **Perf targets:** first-paint ≤200 super-nodes; cold first-paint < 1.0 s; idle GPU 0%; 60 fps galaxy; **100% of notes reachable** (vs 13% today).
- **Smoke:** `graph:clusters` ≤200 super-nodes whose `memberCount` sums to `totalNodes`; `graph:expand-cluster(id)` returns exactly that cluster's members; every node maps to exactly one cluster.

### **Wave 2 — Baked layout off-thread + deterministic positions + ego L2**
- **New** `main/graph-layout.worker.ts` (cluster detection + PCA-seeded settle → transferable Float32Array); **new** `core/api/layout-bake.ts` (PCA + `ForceSim.bake`); on-disk `.bin` cache; `GraphView` consumes baked positions + `graph:ego` + per-cluster frustum-culled sub-batches + shader hover.
- **Targets:** main thread never blocks > 16 ms (Worker); warm open < 150 ms; clump + 2D-line **gone** (smoke asserts a min-spread metric); hover O(1).

### **Wave 3 (optional)** — UMAP, true Leiden, cosmos.gl opt-in 2D mega-mode (100k stretch).

---

## 7. Build vs adopt — **BUILD** (keep R3F)

`THREE.Points` is already one GPU draw call + 3D-native with the signature look; the bottleneck was the per-frame CPU loop + live sim, both fixed in place. 3d-force-graph/reagraph top out ~4–5k (same class as today) and lose the visual identity. cosmos.gl is the only genuine 10× but 2D-only → adopt as an opt-in flat mega-mode (Wave 3), not the default. We borrow the master/view model from sigma/Cytoscape without their renderer.

---

## 8. Risks & mitigations (top)

| Risk | Mitigation |
|---|---|
| Bad/disconnected clusters | Louvain over cosine-weighted edges + **split disconnected communities into connected components** before emitting super-nodes; show memberCount + label. |
| Meaningless labels ("Cluster 7") | activate `extractClusterLabel` (TF-IDF); fall back to representative note title; Wave 3 optional LLM 2-word name. |
| O(n²) edge loop blocks when cap raised | move build into Worker (Wave 2); cap master edge-cap; approximate kNN via sqlite-vec HNSW. |
| Layout still clumps / 2D pinches | PCA/UMAP seed + short settle + hub damping + bounded collide; **separate 2D layout**; smoke asserts min-spread. |
| Stale on-disk bake | key cache by `mode@indexVersion@layoutAlgoVersion`; re-seed from old positions + short settle on edit. |
| Expand/collapse jank | `frameloop="demand"` + invalidate only during the ~400 ms animation; GPU `uExpandT` lerp, not CPU buffer rewrites. |
| Optional deps fail install | pure-JS louvain is small; UMAP/Leiden optional with k-means fallback (matches the "fallback when no API key" pattern). |

---

## Files touched

- `packages/core/src/api/graph-data.ts` — clusters/meta-edges/representative; `buildClusteredGraph`; lift master cap.
- `packages/core/src/types/graph.ts` — tiered types.
- `packages/core/src/store/sqlite-vec.ts` — reuse `getDocumentEmbeddingsByIds` for bake input; optional HNSW kNN.
- `packages/desktop/src/main/index.ts` — `graph:clusters` / `graph:expand-cluster` / `graph:ego`; extend `graphBuildCache`; Worker spawn (Wave 2).
- **NEW** `packages/desktop/src/main/graph-layout.worker.ts` (Wave 2).
- **NEW** `packages/core/src/api/layout-bake.ts` (Wave 2).
- `packages/desktop/src/renderer/components/graph/graph-core.tsx` — super-node/meta-edge buffers; baked positions; shader hover; `MAX_GLOBAL_NODES`; `extractClusterLabel`.
- `packages/desktop/src/renderer/components/graph/force-sim.ts` — headless `bake()`; hub damping; bounded collide; drop per-frame z-zero.
- `packages/desktop/src/renderer/components/graph/GraphView.tsx` — tiered load; LOD switch; expand/collapse + animation; `frameloop="demand"`; per-cluster frustum-culled sub-batches.
- `packages/desktop/src/renderer/components/panels/GraphPanel.tsx` — unchanged this cycle.
