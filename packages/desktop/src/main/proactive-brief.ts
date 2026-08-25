// ③ v2 — pure mapper for the chat empty-state proactive review brief.
// Extracted from the chat:proactive-brief IPC handler so the no-secret invariant is unit-testable:
// the brief that crosses the IPC boundary MUST carry titles / cluster names ONLY — never a
// documentId, filePath, retrievability, lastAccess, or gap severity. Building fresh literals here
// (rather than spreading the source rows) structurally guarantees no extra field leaks.

import type { DecayItem, ProactiveBrief } from '../shared/ipc-types.js';

/** Shape of agentDetectGaps()'s trimmed report (only the part we surface). */
export interface GapsLike {
  gaps?: { between?: string[] }[];
}

/**
 * Map ranked decay rows + a gaps report into the COMPACT public brief.
 * @param decay  top decaying rows (already ranked/limited upstream)
 * @param gaps   trimmed gap report (cluster-name pairs)
 * @param maxDecaying  cap on forgetting chips (default 3)
 * @param maxLinks     cap on weak-link chips (default 2)
 */
export function buildProactiveBrief(
  decay: DecayItem[],
  gaps: GapsLike | null | undefined,
  maxDecaying = 3,
  maxLinks = 2,
): ProactiveBrief {
  const decaying = (decay ?? [])
    .map((d) => ({ title: d.title }))      // TITLE ONLY — drop documentId/filePath/retrievability/lastAccess
    .filter((d) => !!d.title)
    .slice(0, maxDecaying);
  const weakLinks = (gaps?.gaps ?? [])
    .map((g) => ({ a: g.between?.[0] ?? '', b: g.between?.[1] ?? '' })) // cluster NAMES only — drop severity/topic
    .filter((w) => !!w.a && !!w.b)
    .slice(0, maxLinks);
  return { decaying, weakLinks };
}
