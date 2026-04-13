---
title: "RAG Patterns"
tags: [rag, retrieval, llm, architecture]
type: literature
source: "Various blog posts and papers, 2024-2025"
created: 2026-04-13
---

# Retrieval-Augmented Generation (RAG) Patterns

RAG augments LLM responses with retrieved context from external knowledge bases. Critical for reducing hallucination and keeping answers grounded.

## Basic RAG Pipeline

1. **Chunk** documents into passages (500-1000 tokens)
2. **Embed** chunks into vectors
3. **Store** in vector database
4. **Query**: embed user question → retrieve top-K chunks → inject into prompt
5. **Generate**: LLM answers with retrieved context

## Advanced Patterns

- **Hybrid RAG**: BM25 + vector search with RRF fusion
- **Re-ranking**: Use cross-encoder to re-score retrieved chunks
- **Query expansion**: Rewrite query for better retrieval
- **Agentic RAG**: LLM decides what to retrieve iteratively

## Chunking Strategies

| Strategy | Best For |
|----------|----------|
| Fixed-size | Simple, predictable |
| Heading-based | Structured docs (markdown) |
| Semantic | Topic coherence |
| Sliding window | Overlap for context |

## Related

- [[Hybrid Search]] — the retrieval component of RAG
- [[Vector Databases]] — the storage layer
- [[MCP Protocol]] — exposing RAG as MCP tools
