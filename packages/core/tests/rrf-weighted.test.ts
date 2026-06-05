// B3 §5.2 — weighted RRF + bounded recency multiplier (formula-level unit tests).
import { describe, it, expect } from 'vitest';
import { rrfFusionN } from '../src/search/rrf.js';

const L = (...ids: string[]) => ids.map((chunkId) => ({ chunkId, score: 1 }));

describe('rrfFusionN — weighted + recency', () => {
  it('1. omitted/unit weights reproduce the equal-weight default exactly', () => {
    const lists = [L('a', 'b'), L('b', 'c'), L('d')];
    const base = rrfFusionN(lists, 60, 10);
    expect(rrfFusionN(lists, 60, 10, {})).toEqual(base);
    expect(rrfFusionN(lists, 60, 10, { weights: [1, 1, 1] })).toEqual(base);
  });

  it('2. raising one list weight lifts a chunk that appears only in that list', () => {
    const lists = [L('x'), L('y')]; // x only in list0, y only in list1
    expect(rrfFusionN(lists, 60, 10, { weights: [2, 1] })[0].chunkId).toBe('x');
    expect(rrfFusionN(lists, 60, 10, { weights: [0.1, 1] })[0].chunkId).toBe('y');
  });

  it('3. w=0 fully mutes a signal (entity-only chunk gets zero contribution)', () => {
    const lists = [L('a'), L('a'), L('e')]; // a in semantic+bm25, e entity-only
    const r = rrfFusionN(lists, 60, 10, { weights: [1, 1, 0] });
    expect(r[0].chunkId).toBe('a');
    expect(r.find((x) => x.chunkId === 'e')?.score).toBe(0);
  });

  it('4. recency reorders equal-base chunks and stays within the ±bound', () => {
    const lists = [L('hi'), L('lo')]; // identical base (rank 0 each, equal weight)
    const rec = new Map([['hi', 0.9], ['lo', 0.1]]);
    const r = rrfFusionN(lists, 60, 10, { weights: [1, 1], recencyScores: rec, recencyWeight: 0.2 });
    expect(r[0].chunkId).toBe('hi');
    const base = 1 / 61;
    expect(r.find((x) => x.chunkId === 'hi')!.score).toBeCloseTo(base * (1 + 0.2 * (0.9 - 0.5)));
    expect(r.find((x) => x.chunkId === 'lo')!.score).toBeCloseTo(base * (1 + 0.2 * (0.1 - 0.5)));
  });

  it('5. recencyWeight=0 is a kill-switch (identical to no recency)', () => {
    const lists = [L('hi'), L('lo')];
    const noRec = rrfFusionN(lists, 60, 10, { weights: [1, 1] });
    const off = rrfFusionN(lists, 60, 10, {
      weights: [1, 1],
      recencyScores: new Map([['hi', 0.9], ['lo', 0.1]]),
      recencyWeight: 0,
    });
    expect(off).toEqual(noRec);
  });

  it('6. a chunkId missing from recencyScores is treated as neutral (R=0.5)', () => {
    const lists = [L('p'), L('q')]; // q has no recency entry
    const r = rrfFusionN(lists, 60, 10, {
      weights: [1, 1],
      recencyScores: new Map([['p', 0.5]]),
      recencyWeight: 0.2,
    });
    const noRec = rrfFusionN(lists, 60, 10, { weights: [1, 1] });
    expect(r.map((x) => x.chunkId)).toEqual(noRec.map((x) => x.chunkId));
    expect(r[0].score).toBeCloseTo(noRec[0].score);
  });
});
