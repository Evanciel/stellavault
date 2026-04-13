---
title: "Attention Is All You Need"
tags: [paper, transformer, attention, deep-learning]
type: literature
source: "Vaswani et al., 2017"
created: 2026-04-13
---

# Attention Is All You Need

The paper that introduced the Transformer architecture, replacing recurrence with self-attention. Foundation of GPT, BERT, and all modern LLMs.

## Key Innovation

Self-attention computes relationships between all positions in a sequence simultaneously (O(1) sequential operations vs O(n) for RNNs).

## Multi-Head Attention

Instead of single attention, use h parallel heads with different learned projections. Each head captures different relationship types (syntactic, semantic, positional).

## Impact

- Enabled scaling to billions of parameters
- Parallelizable training (vs sequential RNN)
- Foundation for: GPT-4, Claude, Gemini, LLaMA

## Personal Notes

The embedding dimension split across heads (d_model / h per head) is elegant — each head gets a lower-dimensional view, then results are concatenated. This is conceptually similar to ensemble methods.

## Related

- [[Vector Databases]] — embeddings come from transformer models
