// MCP tool: get-morning-brief — Claude 세션 시작 시 자동 브리핑

import type { DecayEngine } from '../../intelligence/decay-engine.js';
import type { VectorStore } from '../../store/types.js';

export const getMorningBriefToolDef = {
  name: 'get-morning-brief',
  description: '오늘의 지식 브리핑을 제공합니다. 감쇠 상태, 리뷰 대상, 최근 활동을 요약합니다. 세션 시작 시 호출하면 유용합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

export async function handleGetMorningBrief(
  decayEngine: DecayEngine,
  store: VectorStore,
) {
  const stats = await store.getStats();
  const report = await decayEngine.computeAll();

  const reviewList = report.topDecaying.slice(0, 5).map(d => ({
    title: d.title,
    retrievability: Math.round(d.retrievability * 100) / 100,
    daysSinceAccess: d.daysSinceAccess,
  }));

  const unhealthyClusters = report.clusterHealth
    .filter(c => c.avgR < 0.6)
    .slice(0, 3)
    .map(c => ({ label: c.label, avgR: c.avgR, count: c.count }));

  return {
    greeting: `📚 ${stats.documentCount}개 노트, 전체 건강도 R=${report.averageR}`,
    summary: {
      totalDocs: stats.documentCount,
      averageR: report.averageR,
      decaying: report.decayingCount,
      critical: report.criticalCount,
    },
    reviewSuggestions: reviewList,
    unhealthyClusters,
    tip: report.criticalCount > 0
      ? `⚠️ ${report.criticalCount}개 노트가 위험 수준입니다. 'stellavault review'로 리뷰하세요.`
      : report.decayingCount > 0
        ? `📋 ${report.decayingCount}개 노트가 감쇠 중입니다.`
        : '✨ 모든 지식이 건강합니다!',
  };
}
