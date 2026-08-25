---
name: vault-review
description: Daily knowledge review — surface the notes the user is forgetting (FSRS memory decay) and the weak spots in their vault (gaps), then propose 2-3 concrete things to revisit or connect. Use when the user asks "what should I review", "what am I forgetting", or wants a knowledge check-in.
---

# Knowledge review (decay + gaps)

Turn Stellavault's memory model into a short, actionable review. This is the one thing a plain notes app cannot do: it knows what the user is *about to forget*.

## Steps

1. Call `get-learning-path` — it returns notes ranked by how close they are to being forgotten (FSRS retrievability).
2. Call `detect-gaps` — weakly-linked or underdeveloped areas of the vault.
3. Produce a compact review, in the user's language:
   - **Revisit now (2-3 notes):** title + one line on why it matters and what it connects to. Prefer notes that are both decaying AND central (linked from others).
   - **One gap worth closing:** a single concrete suggestion ("[[A]] and [[B]] cover the same system but aren't linked", "topic X has 5 fragments and no summary note").
4. End with one question inviting action ("want me to pull up the first one?") — then stop. If the user picks a note, fetch it with `get-document` and summarize what they likely forgot.

## Rules

- Keep the whole review under ~15 lines. This is a nudge, not a report.
- Read-only: never write, rename, or "fix" notes in this skill.
- If both tools return nothing actionable, say the vault looks healthy in one line — do not pad.
