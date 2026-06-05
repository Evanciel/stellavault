# B3 — Weighted RRF + Recency/Decay for Hybrid Search

> Status: Design (ready for `/pdca do`)
> Owner: search/core
> Scope: `packages/core/src/search/*`, `packages/core/src/config.ts`, `packages/core/src/types/search.ts`, MCP wiring
> Supersedes nothing. Extends B2 (entity linking, 3-signal RRF) shipped at `bcebfa1`.
> Plan SC: SC-05 (NDCG/quality ↑), SC-06 (existing tests stay green — currently 27 core test files, 223 core + 12 smoke assertions)

---

## 0. Problem & Goal

Today `rrfFusionN()` fuses three ranked lists (semantic + BM25 + entity) with **equal, unweighted** reciprocal-rank contributions and **no time dimension**:

```ts
// packages/core/src/search/rrf.ts (current)
score(d) = Σ_i  1 / (k + rank_i)      // k = 60, every signal weight = 1
```

Two gaps:

1. **No per-signal weighting.** Entity linking only covers ~20% of the candidate pool (see Research, §1.3). Giving it the same pull as dense/BM25 risks the "weakest-link" degradation documented in arxiv 2508.01405 — once a weak path injects irrelevant candidates, downstream reranking cannot fully recover.
2. **No recency / memory-decay signal.** Stellavault already computes FSRS retrievability per document (`decay_state` table) but search ignores it. A note you are actively forgetting (R≈0.5) should resurface; a mastered evergreen note should not be buried just because it is old.

**Goal:** add (a) configurable per-signal weights to RRF and (b) a recency/decay modulation, both **backward-compatible** (existing callers and the 27 test files must pass unmodified), with safe defaults grounded in the research below.

---

## 1. Research Summary (decisions, not a lit review)

### 1.1 Weighted RRF formula — DECISION

Adopt the industry-standard weighted RRF (Elasticsearch / OpenSearch / Vespa all converge on it):

```
score(d) = Σ_i  w_i · 1 / (k + rank_i)
```

- `k = 60` — **global, single, signal-agnostic** smoothing constant. Keep the existing default. Per-signal `k` (e.g. `k_bm25` ≠ `k_dense`) has **no theoretical or empirical support** (Research finding §1.3); express signal imbalance through `w_i`, never through `k`.
- `w_i` — non-negative float per signal. `w_i = 1` reproduces today's behavior exactly.

### 1.2 Default weights (dense / BM25 / entity) — DECISION

| Signal   | Default weight | Rationale |
|----------|---------------:|-----------|
| semantic (dense) | **1.0** | Primary conceptual signal |
| BM25 (keyword)   | **1.0** | Co-equal; exact match solves different intents than dense |
| entity           | **0.5** | Conservative — ~20% candidate coverage; arxiv 2508.01405 weakest-link risk if over-weighted |

This is the research "safest introduction path": start `(1.0, 1.0, 0.5)`, then A/B `(0.7, 1.0, 0.5)` only after NDCG validation on held-out queries. We do **not** ship aggressive variants by default.

> Note on signal order: the call site fuses `[semantic, bm25, entity]` (see `index.ts:39`). The weights array MUST follow the **same positional order**. We make this explicit in code comments to prevent a silent mis-map.

### 1.3 Recency / decay — DECISION

- **Curve:** exponential power-law via the **existing FSRS retrievability**, NOT a fresh `e^(-λt)` over mtime. Stellavault already persists `stability` + `last_access` and computes `R(t) = (1 + t/(9·S))^(-1)` in `fsrs.ts`. Reusing it gives **personalized** decay (high-difficulty / low-stability notes decay faster) instead of naive recency, and avoids a second, divergent decay implementation.
- **Half-life:** governed by FSRS `stability` (default `initialStability = 7d`, grown on access, capped 365d). We do **not** introduce a separate 14-day half-life knob; the FSRS engine is the single source of decay truth. (The 14-day figure from the recency research is the right *order of magnitude*; FSRS already lands there for fresh notes and adapts per note.)
- **Integration method:** **separate weighted RRF list** is rejected. Retrievability is a *modulation of relevance*, not an independent retriever with its own ranked candidate set — the recency research is explicit that RRF is for multi-retriever fusion, not temporal dimensions. We use a **bounded post-fusion multiplier** on the fused RRF score:

```
final(d) = rrf(d) · (1 + w_recency · (R_d − 0.5))      // R_d ∈ [0,1]
```

  - Centered at `R = 0.5` so the median note is unchanged; at-risk notes (`R < 0.5`) are gently demoted and recently-reinforced notes (`R > 0.5`) gently promoted. This is intentionally **gentle and bounded** to avoid recency dominating relevance (recency research risk: a 1-month-old 0.95-relevance note must still beat a fresh 0.30 note).
  - With default `w_recency = 0.2`, the multiplier stays in `[0.9, 1.1]` — at most ±10% — so relevance hierarchy is preserved (semantic weight stays effectively ~0.7+ of the decision, matching the α≈0.7 guidance).
  - Missing `decay_state` row → treat as `R = 0.5` → multiplier = 1.0 → **no penalty** (graceful for pre-decay-engine docs).

### 1.4 Signal source — DECISION (mtime vs FSRS)

**Use FSRS retrievability, computed live, NOT raw mtime.**

- **Exact DB column(s):** `decay_state.stability` (REAL) + `decay_state.last_access` (TEXT, ISO). Retrievability is **recomputed at query time** via `computeRetrievability(stability, elapsedDays(last_access, now))` — it is NOT read from `decay_state.retrievability` (that column is a batch snapshot that goes stale between `computeAll()` runs).
- Keyed by `decay_state.document_id`. Search results are chunks; we map `chunkId → documentId` (already available after fusion via `store.getChunk()`), then look up FSRS state by `documentId`.
- `documents.last_modified` (mtime-ish) is the **fallback only** when `decayEngine` is absent (CLI fresh-process path) — see §3.4.

---

## 2. Chosen Approach (summary)

1. Add **optional** `weights?: number[]` and `recencyScores?: Map<string, number>` to `rrfFusionN()` — defaulted so all current callers are byte-for-byte equivalent.
2. Apply `w_i` inside the fusion loop; apply recency as a **post-fusion bounded multiplier** (kept inside `rrfFusionN` so the formula lives in one place, but driven by an externally-supplied `Map<chunkId, R>` so RRF stays decoupled from the decay engine).
3. Wire `decayEngine?` into `createSearchEngine()`; build the weights array (from config/`SearchOptions`) and the recency map (from FSRS) at the call site, with full graceful degradation when `decayEngine` is missing.
4. Add config knobs (`search.weights.*`, `search.recencyWeight`) + env overrides, all defaulting to the research-backed safe values.
5. Keep `adaptive.ts` post-fusion boosts **independent** (different signal: session context, not memory decay). Document the interaction; do not double-count.

---

## 3. Detailed Design

### 3.1 `rrfFusionN` — backward-compatible signature change

`packages/core/src/search/rrf.ts`

```ts
// Design Ref: §6.2 — Reciprocal Rank Fusion (weighted, k=60)
// Design Ref: §B3.3.1 — per-signal weights + bounded recency multiplier
// Plan SC: SC-06 — existing rrf.test.ts / search-integration.test.ts stay green

export interface RrfOptions {
  /** Per-list multipliers, positional. Missing/undefined → weight 1 for all
   *  (reproduces pre-B3 equal-weight behavior exactly). */
  weights?: number[];
  /** chunkId → FSRS retrievability R∈[0,1]. Absent entry → R treated as 0.5
   *  (multiplier 1.0, no penalty). Undefined map → recency disabled entirely. */
  recencyScores?: Map<string, number>;
  /** Strength of the recency multiplier. 0 → recency off. Default 0. */
  recencyWeight?: number;
}

export function rrfFusionN(
  lists: ScoredChunk[][],
  k: number = 60,
  limit: number = 10,
  opts: RrfOptions = {},          // ← NEW, optional, defaulted
): ScoredChunk[] {
  const { weights, recencyScores, recencyWeight = 0 } = opts;
  const scores = new Map<string, number>();

  for (let li = 0; li < lists.length; li++) {
    const w = weights?.[li] ?? 1;           // SC-06: undefined → 1
    const list = lists[li];
    for (let i = 0; i < list.length; i++) {
      const id = list[i].chunkId;
      scores.set(id, (scores.get(id) ?? 0) + w * (1 / (k + i + 1)));
    }
  }

  // Bounded recency modulation (post-fusion). Off when recencyWeight === 0
  // OR recencyScores is undefined → byte-identical to pre-B3 output.
  if (recencyWeight > 0 && recencyScores) {
    for (const [id, s] of scores) {
      const r = recencyScores.get(id) ?? 0.5;          // missing → neutral
      scores.set(id, s * (1 + recencyWeight * (r - 0.5)));
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([chunkId, score]) => ({ chunkId, score }));
}

/** Two-list RRF (semantic + BM25). Retained for backward compatibility. */
export function rrfFusion(
  listA: ScoredChunk[],
  listB: ScoredChunk[],
  k: number = 60,
  limit: number = 10,
): ScoredChunk[] {
  return rrfFusionN([listA, listB], k, limit);   // unchanged — no opts passed
}
```

**Why a single `opts` object instead of two trailing positional params?** The codeSurface runbook suggested `(lists, k, limit, weights?, recencyScores?)`. An options object is the safer choice: it keeps the 4th argument self-documenting and lets us add `recencyWeight` without a 6th positional param. Crucially, **`rrfFusion(a,b,k,limit)` and every current `rrfFusionN([...], k, limit)` call pass no 4th arg**, so `opts = {}` and behavior is identical. This satisfies SC-06 for `rrf.test.ts` (which calls `rrfFusion` only) with zero test edits.

### 3.2 `createSearchEngine` — weights + recency assembly

`packages/core/src/search/index.ts`

```ts
// Design Ref: §B3.3.2 — assemble weights + FSRS recency at the fusion call site
import type { DecayEngine } from '../intelligence/decay-engine.js';
import { computeRetrievability, elapsedDays } from '../intelligence/fsrs.js';

export interface SignalWeights {
  semantic?: number;
  bm25?: number;
  entity?: number;
  recency?: number;   // strength of the post-fusion recency multiplier
}

// Design Ref: §1.2 / §1.3 — research-backed safe defaults
export const DEFAULT_SIGNAL_WEIGHTS: Required<SignalWeights> = {
  semantic: 1.0,
  bm25: 1.0,
  entity: 0.5,    // conservative: ~20% candidate coverage (arxiv 2508.01405)
  recency: 0.2,   // ±10% bound on relevance
};

export function createSearchEngine(deps: {
  store: VectorStore;
  embedder: Embedder;
  rrfK?: number;
  decayEngine?: DecayEngine;          // ← NEW, optional
  weights?: SignalWeights;            // ← NEW, optional (config-supplied default)
}): SearchEngine {
  const { store, embedder, rrfK = 60, decayEngine } = deps;
  const baseWeights = { ...DEFAULT_SIGNAL_WEIGHTS, ...deps.weights };
  const FETCH_LIMIT = 30;

  return {
    async search(options: SearchOptions): Promise<SearchResult[]> {
      const { query, limit = 10, threshold = 0.0, tags, signalWeights } = options;

      // Per-query override merges over engine default. (§3.5)
      const w = { ...baseWeights, ...signalWeights };

      const [bm25Results, semanticResults, entityResults] = await Promise.all([
        searchBm25(store, query, FETCH_LIMIT),
        searchSemantic(store, embedder, query, FETCH_LIMIT),
        searchEntities(store, query, FETCH_LIMIT),
      ]);

      // POSITIONAL: [semantic, bm25, entity] — weights array MUST match order.
      const lists = [semanticResults, bm25Results, entityResults];
      const weights = [w.semantic, w.bm25, w.entity];

      // Build recency map only when a decay engine is available (graceful skip).
      const recencyScores = decayEngine
        ? await buildRecencyMap(store, decayEngine, lists)
        : undefined;

      const fused = rrfFusionN(lists, rrfK, limit * 2, {
        weights,
        recencyScores,
        recencyWeight: recencyScores ? w.recency : 0,
      });

      // ... unchanged: chunk/doc fetch + threshold + tag filter loop ...
    },
  };
}
```

**`buildRecencyMap` helper** (same file or `search/recency.ts`):

```ts
// Design Ref: §1.4 — FSRS retrievability computed LIVE from stability+last_access.
//   NOT decay_state.retrievability (stale snapshot). Source columns:
//   decay_state.stability (REAL), decay_state.last_access (TEXT ISO).
async function buildRecencyMap(
  store: VectorStore,
  decay: DecayEngine,
  lists: ScoredChunk[][],
): Promise<Map<string, number>> {
  // 1. Collect unique chunkIds that survived into fusion candidates.
  const chunkIds = new Set<string>();
  for (const l of lists) for (const c of l) chunkIds.add(c.chunkId);

  // 2. chunkId → documentId (batch). decay_state is keyed by documentId.
  // 3. Read decay_state.{stability,last_access} for those docs in ONE query
  //    (read-only; uses idx_decay_state_*; no writes during search — avoids
  //    lock contention with recordAccess, codeSurface risk #8).
  // 4. R = computeRetrievability(stability, elapsedDays(last_access, now)).
  //    Missing row → omit (rrfFusionN defaults it to 0.5 = neutral).
  const rByDoc = await decay.getRetrievabilityForDocs([...docIds]); // NEW method, §3.3
  const map = new Map<string, number>();
  for (const { chunkId, documentId } of chunkDocPairs) {
    const r = rByDoc.get(documentId);
    if (r !== undefined) map.set(chunkId, r);
  }
  return map;
}
```

### 3.3 `DecayEngine` — new read-only batch accessor

The store interface has **no** `getDecayState` method (confirmed: `store/types.ts` exposes only `getDb()`). Rather than leak SQL into the search layer, add a focused read-only method to `DecayEngine`:

`packages/core/src/intelligence/decay-engine.ts`

```ts
// Design Ref: §B3.3.3 — live retrievability for a set of docs, read-only.
//   Reuses persisted stability+last_access; recomputes R (no stale snapshot,
//   no writes). Single parametrized query; missing docs simply absent from map.
async getRetrievabilityForDocs(documentIds: string[]): Promise<Map<string, number>> {
  if (documentIds.length === 0) return new Map();
  const now = new Date().toISOString();
  const placeholders = documentIds.map(() => '?').join(',');
  const rows = this.db.prepare(
    `SELECT document_id, stability, last_access
       FROM decay_state WHERE document_id IN (${placeholders})`
  ).all(...documentIds) as Array<{ document_id: string; stability: number; last_access: string }>;
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.document_id, computeRetrievability(r.stability, elapsedDays(r.last_access, now)));
  }
  return out;
}
```

(Chunk-batch sizes are bounded by `FETCH_LIMIT × 3 = 90` candidates → at most ~90 docs in the `IN (...)` clause — well within SQLite's parameter limit.)

### 3.4 MCP wiring

`packages/core/src/mcp/server.ts` constructs the search engine elsewhere and only receives a built `searchEngine`. The fix belongs at the **construction site** that has the `decayEngine` in scope (the daemon/bootstrap that calls `createMcpServer({ store, searchEngine, decayEngine })`). Pass `decayEngine` into `createSearchEngine` there:

```ts
// at bootstrap (wherever createSearchEngine + createMcpServer are wired):
const baseSearch = createSearchEngine({ store, embedder, rrfK, decayEngine, weights });
// adaptive wrapper unchanged — it sits ON TOP of the (now recency-aware) base.
```

- **CLI path** (`search-cmd.ts`, `init-cmd.ts`): each command is a fresh short-lived process with **no** `decayEngine` → `createSearchEngine` is called without it → `recencyScores = undefined` → recency cleanly disabled, weights still apply. This is the intended degradation; no CLI change required beyond optionally threading config weights.

### 3.5 `SearchOptions` — per-query override (optional)

`packages/core/src/types/search.ts`

```ts
export interface SearchOptions {
  query: string;
  limit?: number;
  threshold?: number;
  tags?: string[];
  dateRange?: { from?: string; to?: string };
  /** Per-query weight override. Merges over engine/config defaults. (B3 §3.5) */
  signalWeights?: { semantic?: number; bm25?: number; entity?: number; recency?: number };
}
```

Purely additive optional field → no existing caller breaks.

### 3.6 `adaptive.ts` interaction — NO CHANGE

`createAdaptiveSearch` reranks **after** the base engine returns, using session context (tag overlap 0–0.3, path proximity 0–0.2). This is an **orthogonal signal** (what you are currently working on), distinct from FSRS memory decay (what you are forgetting). They compose multiplicatively and intentionally stack:

```
displayed = rrf · (1 + w_recency·(R−0.5))  ·  (1 + adaptiveBoost)
            └────────── base engine ──────┘   └─ adaptive wrapper ─┘
```

Documented as intended, not double-counting. No edit to `adaptive.ts`.

---

## 4. Config & Env Knobs (safe defaults)

`packages/core/src/config.ts` — extend the `search` block (mirroring the existing `rrfK` pattern):

```ts
search: {
  defaultLimit: number;
  rrfK: number;
  weights?: { semantic?: number; bm25?: number; entity?: number };  // NEW
  recencyWeight?: number;                                            // NEW
}
```

```ts
// DEFAULT_CONFIG.search
search: {
  defaultLimit: 10,
  rrfK: 60,
  weights: { semantic: 1.0, bm25: 1.0, entity: 0.5 },   // §1.2
  recencyWeight: 0.2,                                    // §1.3 (±10% bound)
},
```

Update `mergeConfig` to deep-merge `search.weights` (so a partial override like `{ entity: 0.3 }` keeps the other two defaults):

```ts
search: {
  ...defaults.search,
  ...overrides.search,
  weights: { ...defaults.search.weights, ...overrides.search?.weights },
},
```

**Env overrides** (read in the bootstrap that builds the engine; keep `.trim()` per project rule, parse with guards):

| Env var | Maps to | Default | Notes |
|---------|---------|--------:|-------|
| `STELLAVAULT_W_SEMANTIC` | `weights.semantic` | 1.0 | float ≥ 0 |
| `STELLAVAULT_W_BM25` | `weights.bm25` | 1.0 | float ≥ 0 |
| `STELLAVAULT_W_ENTITY` | `weights.entity` | 0.5 | float ≥ 0 |
| `STELLAVAULT_RECENCY_WEIGHT` | `recencyWeight` | 0.2 | clamp to `[0, 1]`; 0 = recency off |

Parsing: `const n = Number(String(process.env.X ?? '').trim()); if (Number.isFinite(n) && n >= 0) use(n);` — invalid/empty → fall through to config default. **Defaults reproduce a sane shipped behavior even if every env var is unset or garbage.**

---

## 5. REGRESSION-GUARD Test Plan

### 5.1 Existing tests that MUST stay green (no edits)

| File | Why it stays green |
|------|--------------------|
| `tests/rrf.test.ts` | Calls `rrfFusion(a,b,k,limit)` only → `opts={}` → identical math. The 4 cases (both-list boost, limit, empty, k-impact) are untouched. |
| `tests/search-integration.test.ts` | `createSearchEngine({store, embedder})` — no `decayEngine` → recency disabled; default weights `(1,1,0.5)`. **Verify the 6 cases still hold** (NL query, tag filter, limit, empty query, highlights, nonexistent tag). Entity weight 0.5 only changes magnitudes, not the asserted presence/filter/limit invariants. |
| `tests/entity-search.test.ts` | **Critical invariant** `xi < yi` (entity-matching chunk ranks higher). With `w_entity = 0.5 > 0`, the entity list's positive contribution still lifts `doc#x` over the otherwise-identical `doc#y`. Recency multiplier is **equal** for both (same `documentId` → same R) so it cannot reorder them. Stays green. |
| `tests/adaptive-search.test.ts` | `adaptive.ts` unchanged; base engine without `decayEngine` behaves as before. Passthrough + tag/path boosts unaffected. |
| `tests/pack.test.ts`, `api-routes.test.ts`, `api-card.test.ts` | All call `createSearchEngine({store, embedder})` — default path, no recency. Unaffected. |
| `tests/fsrs.test.ts` | `computeRetrievability` / `updateStability` signatures unchanged; we only *call* them. |
| `tests/mcp.test.ts`, `mcp-tools-extended.test.ts` | MCP wiring stays optional (`decayEngine?`); tools that don't pass it behave as before. |

> Run after every step: `npm test -w packages/core` (27 files / 223 assertions) **and** `node tests/smoke.mjs` (12). Both must be 🟢 before commit per project gates.

### 5.2 New tests to ADD

**`tests/rrf-weighted.test.ts`** (unit, formula-level):

1. `weights=[1,1,1]` (or omitted) ⇒ output **identical** to current `rrfFusionN` (snapshot equality on a fixed 3-list fixture) — proves the default path is a no-op.
2. Raising one list's weight moves a chunk that appears **only** in that list upward; verify rank flips at a known threshold (e.g. `[0.1, 1, 1]` demotes a semantic-only chunk below a BM25-only one).
3. `w_entity = 0` ⇒ entity-only chunk drops out of top-k (signal fully muted).
4. `recencyWeight` math: two chunks with identical RRF base, R=0.9 vs R=0.1 ⇒ high-R ranks first; multiplier stays within `[1−0.5·rw, 1+0.5·rw]` (bound check).
5. `recencyScores` provided but `recencyWeight=0` ⇒ identical to no-recency (kill-switch works).
6. Missing chunkId in `recencyScores` ⇒ treated as 0.5 ⇒ no reorder vs a neutral baseline.

**`tests/search-recency.test.ts`** (integration, with a real in-memory store + `DecayEngine`):

7. Insert two docs whose chunks are near-identical in content/embedding; set one doc's `decay_state` to high R (recent `last_access`, healthy stability) and the other to low R (old `last_access`). Build engine **with** `decayEngine`; assert the high-R doc ranks above the low-R doc, AND that the same query **without** `decayEngine` does not reorder them (isolates the recency effect).
8. Doc with **no** `decay_state` row participates normally (no crash, treated neutral) — guards the "incomplete decay data" risk.
9. `getRetrievabilityForDocs([])` ⇒ empty map; `getRetrievabilityForDocs([unknownId])` ⇒ empty map (no throw).
10. Per-query `signalWeights` override beats engine default: `search({query, signalWeights:{entity:0}})` mutes entity for that call only; a subsequent default call restores it.

**`tests/config-weights.test.ts`** (config):

11. Default config exposes `weights {1,1,0.5}` + `recencyWeight 0.2`.
12. Partial override `{ search: { weights: { entity: 0.3 } } }` deep-merges (semantic/bm25 stay 1.0).
13. Env parse: valid `STELLAVAULT_RECENCY_WEIGHT=0.4` applies; `=abc` and out-of-range fall back to default; clamp `>1 → 1`.

---

## 6. Threat Model Gate (Phase 6 — project rule)

1. **Malicious input:** weights/`recencyWeight` from env/config are parsed with finite + range guards; negative/NaN → default. No user-query value enters the weight path. ✅
2. **DoS:** recency lookup is one bounded `IN (...)` query over ≤90 docs, read-only, indexed; no per-result N+1 (codeSurface risk #1 mitigated by batching). ✅
3. **Privacy:** no new data leaves the process; recency uses already-local FSRS state. ✅
4. **Trust abuse:** n/a (no federation surface touched). ✅
5. **Data integrity:** `getRetrievabilityForDocs` is **read-only** — no writes during search, so no contention with `recordAccess` (codeSurface risk #8). FSRS `decay_state` is never mutated by the search path. ✅

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Entity over-weighting (weakest-link, arxiv 2508.01405) | Default `w_entity = 0.5`; never ship `>0.6` without NDCG validation. Per-signal monitoring recommended. |
| Recency drowns relevance | Centered, bounded multiplier (±10% at `rw=0.2`); evergreen-note regression test (§5.2 #7–8). |
| `decayEngine` coupling into search | Strictly optional; CLI/missing-engine path disables recency, weights still apply (§3.4). |
| Score inflation past 1.0 | Recency is **multiplicative** in `[0.9,1.1]`, not additive; RRF scores already un-normalized but ordering-only. Threshold filter unaffected (relative). |
| Stale `decay_state.retrievability` | We **ignore** that column and recompute live from `stability`+`last_access` (§1.4). |
| Double-boost with adaptive | Declared orthogonal & intended; documented in §3.6, covered by adaptive tests staying green. |
| Mis-mapped weights array vs list order | Single positional source of truth + explicit comment; unit test #2 would catch a swap. |
| Drift over time (one-time tuning fails) | Knobs are config/env; recommend quarterly re-validation. No code change needed to retune. |

---

## 8. Implementation Checklist (numbered)

1. **`rrf.ts`** — add `RrfOptions` interface; change `rrfFusionN` to accept `opts: RrfOptions = {}`; apply per-list `weights?.[li] ?? 1`; apply bounded recency multiplier guarded by `recencyWeight > 0 && recencyScores`. Leave `rrfFusion` wrapper untouched. Add `// Design Ref §6.2/§B3.3.1` + `// Plan SC: SC-06` comments. → run `npm test -w packages/core` (rrf.test.ts must pass unedited).
2. **`decay-engine.ts`** — add read-only `getRetrievabilityForDocs(documentIds: string[]): Promise<Map<string,number>>` (single `IN (...)` query, live `computeRetrievability`). `// Design Ref §B3.3.3`.
3. **`search/index.ts`** — import `DecayEngine`, `computeRetrievability`, `elapsedDays`; add `DEFAULT_SIGNAL_WEIGHTS`, `SignalWeights`; extend `createSearchEngine` deps with `decayEngine?` + `weights?`; build `lists`/`weights`/`recencyScores`; call `rrfFusionN(lists, rrfK, limit*2, {weights, recencyScores, recencyWeight})`. Add `buildRecencyMap` helper (chunkId→documentId→R, neutral on miss). `// Design Ref §B3.3.2`.
4. **`types/search.ts`** — add optional `signalWeights?` to `SearchOptions`. `// Design Ref §B3.3.5`.
5. **`config.ts`** — add `search.weights?` + `search.recencyWeight?` to interface + `DEFAULT_CONFIG`; deep-merge `search.weights` in `mergeConfig`. `// Design Ref §B3.4`.
6. **Bootstrap/MCP wiring** — at the site that calls `createSearchEngine` + `createMcpServer`, pass `decayEngine` and config-derived `weights`/`recencyWeight`; add env-override parsing (`STELLAVAULT_W_*`, `STELLAVAULT_RECENCY_WEIGHT`) with finite/range guards + `.trim()`. (CLI commands left on the default no-recency path.)
7. **Add tests** — `rrf-weighted.test.ts` (cases 1–6), `search-recency.test.ts` (cases 7–10), `config-weights.test.ts` (cases 11–13).
8. **Regression run** — `npm test -w packages/core` (all 27 files green) + `node tests/smoke.mjs` (12 green). Fix any red before proceeding.
9. **Threat-model gate** (§6) — confirm read-only recency, bounded multiplier, guarded parsing. Document any Medium findings for Phase 7.
10. **Docs/comments** — ensure signal order `[semantic, bm25, entity]`, default-weight rationale, recency formula, and override precedence are commented at the call site and in `rrf.ts`. Update CHANGELOG entry for B3.

---

## 9. Acceptance Criteria

- `createSearchEngine({store, embedder})` (no `decayEngine`) produces **identical** results to pre-B3 for the existing integration fixtures (defaults: entity 0.5 changes magnitudes only; all asserted invariants hold). SC-06.
- With `decayEngine` wired, a high-R note outranks a content-identical low-R note; without it, order is unchanged. (§5.2 #7)
- `search({ signalWeights: { entity: 0 } })` mutes entity for that call only.
- All 27 core test files + 12 smoke assertions green; new B3 tests green. SC-05/SC-06.
- Config + env knobs override safely; garbage env falls back to research defaults.
