---
title: "Hybrid Search"
tags: [search, bm25, vectors, rrf]
type: wiki
created: 2026-04-13
---

# Hybrid Search

Combining keyword search (BM25) with semantic vector search produces better results than either alone. Reciprocal Rank Fusion (RRF) merges ranked lists from both.

## BM25 vs Vector

| Aspect | BM25 | Vector |
|--------|------|--------|
| Matches | Exact terms | Semantic meaning |
| Strength | Specific names, codes | Conceptual queries |
| Weakness | Synonym blind | Ignores exact terms |

## RRF Formula

```
RRF_score(d) = sum(1 / (k + rank_i(d)))  for each ranker i
```

Where `k=60` is standard. Documents ranked high by both methods get the best combined score.

## Implementation Pattern

1. Run BM25 search → get top N results with ranks
2. Run vector search → get top N results with ranks
3. Merge via RRF → re-rank by combined score
4. Return top K results

## Related

- [[Vector Databases]] — the vector search component
- [[Spaced Repetition]] — using search frequency to combat forgetting
