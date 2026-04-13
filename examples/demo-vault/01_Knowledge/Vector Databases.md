---
title: "Vector Databases"
tags: [database, vectors, embeddings, search]
type: wiki
created: 2026-04-13
---

# Vector Databases

Vector databases store high-dimensional vectors (embeddings) and enable fast similarity search using algorithms like HNSW, IVF, or brute-force cosine distance.

## Key Concepts

- **Embedding**: A dense numerical representation of text/images (e.g., 384-dim from MiniLM)
- **Cosine Similarity**: Measures angle between vectors; 1.0 = identical, 0 = orthogonal
- **HNSW**: Hierarchical Navigable Small World — graph-based approximate nearest neighbor
- **Quantization**: Compress vectors (float32 → int8) to reduce memory 4x

## Popular Options

| Database | Type | Best For |
|----------|------|----------|
| sqlite-vec | Embedded | Local-first apps, edge |
| Pinecone | Cloud | Managed, scale-to-zero |
| Qdrant | Self-hosted | Rich filtering + vectors |
| pgvector | PostgreSQL | Existing Postgres users |

## Related

- [[Hybrid Search]] — combining vector + keyword search
- [[Knowledge Graphs]] — structured relationships vs. embedding similarity
