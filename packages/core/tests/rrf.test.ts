import { describe, it, expect } from 'vitest';
import { rrfFusion } from '../src/search/rrf.js';

describe('rrfFusion', () => {
  it('양쪽 리스트에 있는 항목이 상위', () => {
    const listA = [{ chunkId: 'a', score: 0.9 }, { chunkId: 'b', score: 0.8 }];
    const listB = [{ chunkId: 'b', score: 0.95 }, { chunkId: 'c', score: 0.7 }];
    const result = rrfFusion(listA, listB, 60, 10);
    expect(result[0].chunkId).toBe('b'); // 양쪽 모두 등장
  });

  it('limit 적용', () => {
    const listA = [{ chunkId: 'a', score: 1 }, { chunkId: 'b', score: 0.9 }, { chunkId: 'c', score: 0.8 }];
    const result = rrfFusion(listA, [], 60, 2);
    expect(result.length).toBe(2);
  });

  it('빈 리스트 처리', () => {
    const result = rrfFusion([], [], 60, 10);
    expect(result).toEqual([]);
  });

  it('k 값에 따라 점수 변동', () => {
    const list = [{ chunkId: 'a', score: 1 }];
    const r1 = rrfFusion(list, [], 10, 10);  // 1/(10+1) = 0.0909
    const r2 = rrfFusion(list, [], 60, 10);  // 1/(60+1) = 0.0164
    expect(r1[0].score).toBeGreaterThan(r2[0].score);
  });
});
