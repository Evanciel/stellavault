---
name: vault-decision
description: Log an architecture/technical decision (ADR) into the user's Stellavault vault, or look up past decisions. Use when the user says "log this decision", "why did we choose X?", or a conversation lands on a clear technical choice worth recording.
---

# Decision journal (ADR)

Record decisions with their *why*, so future sessions can answer "why is it like this?" from the vault instead of guessing.

## Look up a past decision

Call `find-decisions` with the topic. Present matches as: decision — rationale — date — `[[source note]]`. If nothing matches, fall back to `search` before concluding it was never recorded.

## Log a new decision

1. Extract the three parts from the conversation. If any is missing, ask one short question — do not invent:
   - **Decision** — what was chosen ("Use X instead of Y")
   - **Rationale** — why (the non-obvious reason; failures/constraints count)
   - **Alternatives** — what was rejected and why
2. Check `find-decisions` first so you extend rather than duplicate an existing ADR on the same topic.
3. **Show the draft to the user and get a yes** before writing — one compact block: title / decision / rationale / alternatives.
4. On approval, call `log-decision` with the finalized text. Confirm with the created note reference.

## Rules

- Never log without explicit user approval of the exact text.
- One decision per entry — split compound decisions.
- Write in the user's language; keep technical identifiers (library names, versions) verbatim.
