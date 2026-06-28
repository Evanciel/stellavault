// ③ v2 — the proactive review brief MUST cross the IPC boundary carrying titles / cluster names
// ONLY. These tests lock the no-secret invariant (no documentId/filePath/retrievability/lastAccess/
// severity leaks) and the chip caps, against the pure mapper behind chat:proactive-brief.

import { describe, it, expect } from 'vitest';
import { buildProactiveBrief } from '../src/main/proactive-brief.js';
import type { DecayItem } from '../src/shared/ipc-types.js';

const decayRows: DecayItem[] = [
  { documentId: 'doc-1', title: 'Avalon OS', retrievability: 0.4, lastAccess: '2026-03-01', filePath: 'F:/vault/Avalon.md' },
  { documentId: 'doc-2', title: 'Lessons Learned', retrievability: 0.42, lastAccess: '2026-03-02', filePath: 'F:/vault/Lessons.md' },
  { documentId: 'doc-3', title: 'PEFT', retrievability: 0.48, lastAccess: '2026-03-03', filePath: 'F:/vault/PEFT.md' },
  { documentId: 'doc-4', title: 'Extra', retrievability: 0.49, lastAccess: '2026-03-04', filePath: 'F:/vault/Extra.md' },
];
const gaps = { gaps: [
  { between: ['Quant', 'Risk'], suggestedTopic: 'sizing', severity: 'high' },
  { between: ['Agents', 'Memory'], suggestedTopic: 'recall', severity: 'low' },
  { between: ['A', 'B'], suggestedTopic: 'x', severity: 'low' },
] };

describe('buildProactiveBrief — no-secret payload', () => {
  it('decaying entries carry ONLY {title} — no id/filePath/retrievability/lastAccess', () => {
    const brief = buildProactiveBrief(decayRows, gaps);
    for (const d of brief.decaying) {
      expect(Object.keys(d)).toEqual(['title']);
      const leaked = d as Record<string, unknown>;
      expect(leaked.documentId).toBeUndefined();
      expect(leaked.filePath).toBeUndefined();
      expect(leaked.retrievability).toBeUndefined();
      expect(leaked.lastAccess).toBeUndefined();
    }
  });

  it('weakLinks entries carry ONLY {a,b} — no severity/suggestedTopic', () => {
    const brief = buildProactiveBrief(decayRows, gaps);
    for (const w of brief.weakLinks) {
      expect(Object.keys(w).sort()).toEqual(['a', 'b']);
      const leaked = w as Record<string, unknown>;
      expect(leaked.severity).toBeUndefined();
      expect(leaked.suggestedTopic).toBeUndefined();
    }
  });

  it('caps chips (decaying<=3, weakLinks<=2) and preserves order', () => {
    const brief = buildProactiveBrief(decayRows, gaps);
    expect(brief.decaying).toHaveLength(3);
    expect(brief.decaying.map((d) => d.title)).toEqual(['Avalon OS', 'Lessons Learned', 'PEFT']);
    expect(brief.weakLinks).toHaveLength(2);
    expect(brief.weakLinks[0]).toEqual({ a: 'Quant', b: 'Risk' });
  });

  it('drops titleless decay rows and incomplete gap pairs', () => {
    const brief = buildProactiveBrief(
      [{ documentId: 'x', title: '', retrievability: 0.4, lastAccess: '', filePath: 'p' }],
      { gaps: [{ between: ['only-one'] }, { between: ['', 'b'] }] },
    );
    expect(brief.decaying).toHaveLength(0);
    expect(brief.weakLinks).toHaveLength(0);
  });

  it('degrades to empty arrays on empty/missing input', () => {
    expect(buildProactiveBrief([], null)).toEqual({ decaying: [], weakLinks: [] });
    expect(buildProactiveBrief([], undefined)).toEqual({ decaying: [], weakLinks: [] });
  });
});
