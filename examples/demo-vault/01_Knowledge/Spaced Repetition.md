---
title: "Spaced Repetition"
tags: [learning, fsrs, memory, decay]
type: wiki
created: 2026-04-13
---

# Spaced Repetition

Review information at increasing intervals to combat the forgetting curve. FSRS (Free Spaced Repetition Scheduler) is the modern algorithm used by Anki and Stellavault.

## FSRS Parameters

- **Stability (S)**: days until retrievability drops to 90%. Higher = better retained.
- **Difficulty (D)**: how hard the material is (1-10 scale)
- **Retrievability (R)**: probability of recall at time t. R = exp(-t/S)

## Knowledge Decay

Without review, R decreases exponentially. Stellavault tracks R for every note and surfaces "decaying" knowledge (R < 0.5) for review.

```
R(t) = exp(-t / S)

If S = 7 days:
  Day 0:  R = 1.00  (just learned)
  Day 7:  R = 0.37  (needs review)
  Day 14: R = 0.14  (nearly forgotten)
```

## Integration with Knowledge Graphs

Decay-aware graphs can highlight which knowledge clusters are "fading" — enabling targeted review of entire topic areas, not just individual cards.

## Related

- [[Knowledge Graphs]] — graph-level decay tracking
- [[Hybrid Search]] — search access resets decay timers
