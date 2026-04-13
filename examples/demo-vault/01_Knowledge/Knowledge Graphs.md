---
title: "Knowledge Graphs"
tags: [graph, knowledge, zettelkasten, connections]
type: wiki
created: 2026-04-13
---

# Knowledge Graphs

A knowledge graph represents information as nodes (entities) and edges (relationships). Unlike flat document stores, graphs reveal hidden connections and enable traversal-based discovery.

## Zettelkasten Method

Niklas Luhmann's slip-box system: each note is atomic, linked to others via explicit references. The graph emerges from bottom-up connections, not top-down hierarchy.

Principles:
1. **Atomic notes** — one idea per note
2. **Unique IDs** — permanent addresses
3. **Explicit links** — [[wikilinks]] between related notes
4. **Emergence** — clusters and gaps appear naturally

## Graph Metrics

- **Degree centrality**: notes with most connections = knowledge hubs
- **Betweenness**: notes that bridge different clusters = bridging knowledge
- **Isolated nodes**: notes with 0-1 connections = potential knowledge gaps

## Visualization

3D force-directed graphs (Three.js) reveal cluster structure that's invisible in flat lists. Color-coding by cluster, size by connection count.

## Related

- [[Vector Databases]] — alternative to graph-based retrieval
- [[Spaced Repetition]] — maintaining graph health over time
