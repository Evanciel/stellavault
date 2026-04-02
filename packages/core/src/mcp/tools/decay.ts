// Design Ref: §4.2 — MCP tool: get-decay-status
// Plan SC: SC-04

import type { DecayEngine } from '../../intelligence/decay-engine.js';

export const getDecayStatusToolDef = {
  name: 'get-decay-status',
  description: '잊어가는 지식 노트를 조회합니다. 기억 강도(retrievability)가 낮은 노트 목록을 반환하여 리마인드합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      threshold: { type: 'number', description: '감쇠 임계값 (0~1, default: 0.5). 이 값 이하인 노트를 반환' },
      limit: { type: 'number', description: '반환할 최대 노트 수 (default: 20)' },
    },
  },
};

export async function handleGetDecayStatus(
  decayEngine: DecayEngine,
  args: { threshold?: number; limit?: number },
) {
  const threshold = args.threshold ?? 0.5;
  const limit = args.limit ?? 20;

  const decaying = await decayEngine.getDecaying(threshold, limit);

  return {
    count: decaying.length,
    threshold,
    notes: decaying.map(d => ({
      title: d.title,
      retrievability: Math.round(d.retrievability * 100) / 100,
      stability: Math.round(d.stability * 10) / 10,
      lastAccess: d.lastAccess,
    })),
    tip: decaying.length > 0
      ? `${decaying.length}개의 노트를 잊어가고 있습니다. 리뷰를 권장합니다.`
      : '모든 지식이 건강한 상태입니다!',
  };
}
