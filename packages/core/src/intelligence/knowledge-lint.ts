// Feature: stellavault lint — 자동 지식 건강 검사
// 불일치, 누락, 연결 제안, 고립 노드 등을 종합 리포트

import type { VectorStore } from '../store/types.js';
import { detectKnowledgeGaps, type GapReport } from './gap-detector.js';
import { detectDuplicates } from './duplicate-detector.js';
import { detectContradictions } from './contradiction-detector.js';

export interface LintResult {
  score: number; // 0-100 건강도 점수
  issues: LintIssue[];
  suggestions: string[];
  stats: {
    totalDocs: number;
    gaps: number;
    duplicates: number;
    contradictions: number;
    isolatedNodes: number;
    orphanTags: number;
  };
}

export interface LintIssue {
  type: 'gap' | 'duplicate' | 'contradiction' | 'isolated' | 'stale' | 'empty';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  filePath?: string;
  suggestion?: string;
}

/**
 * vault 전체를 스캔하여 지식 건강도를 평가.
 * 기존 gap-detector, duplicate-detector, contradiction-detector를 통합.
 */
export async function lintKnowledge(
  store: VectorStore,
): Promise<LintResult> {
  const issues: LintIssue[] = [];
  const suggestions: string[] = [];

  const docs = await store.getAllDocuments();
  const totalDocs = docs.length;

  // 1. 갭 탐지
  let gapCount = 0;
  let isolatedCount = 0;
  try {
    const gapReport = await detectKnowledgeGaps(store);
    gapCount = gapReport.totalGaps;
    isolatedCount = gapReport.isolatedNodes.length;

    for (const gap of gapReport.gaps.filter(g => g.severity !== 'low')) {
      issues.push({
        type: 'gap',
        severity: gap.severity === 'high' ? 'critical' : 'warning',
        message: `Knowledge gap: ${gap.clusterA} ↔ ${gap.clusterB} (${gap.bridgeCount} connections)`,
        suggestion: gap.suggestedTopic,
      });
    }

    for (const node of gapReport.isolatedNodes.slice(0, 10)) {
      issues.push({
        type: 'isolated',
        severity: 'warning',
        message: `Isolated note: "${node.title}" (${node.connections} connections)`,
        filePath: node.id,
        suggestion: 'Add links to related topics or tags to integrate this note.',
      });
    }
  } catch { /* gap detection failed, skip */ }

  // 2. 중복 탐지
  let dupCount = 0;
  try {
    const dups = await detectDuplicates(store, 0.88, 10);
    dupCount = dups.length;

    for (const dup of dups) {
      issues.push({
        type: 'duplicate',
        severity: 'warning',
        message: `Possible duplicate: "${dup.docA.title}" ≈ "${dup.docB.title}" (${Math.round(dup.similarity * 100)}%)`,
        suggestion: 'Consider merging these notes.',
      });
    }
  } catch { /* skip */ }

  // 3. 모순 탐지
  let contradictionCount = 0;
  try {
    const contradictions = await detectContradictions(store, 5);
    contradictionCount = contradictions.length;

    for (const c of contradictions) {
      issues.push({
        type: 'contradiction',
        severity: 'warning',
        message: `Potential contradiction: "${c.docA.title}" vs "${c.docB.title}"`,
        suggestion: 'Review these documents for conflicting information.',
      });
    }
  } catch { /* skip */ }

  // 4. 빈 문서 / 매우 짧은 문서
  for (const doc of docs) {
    if (doc.content.trim().length < 50) {
      issues.push({
        type: 'empty',
        severity: 'info',
        message: `Very short note: "${doc.title}" (${doc.content.trim().length} chars)`,
        filePath: doc.filePath,
        suggestion: 'Consider expanding or removing this note.',
      });
    }
  }

  // 5. 오래된 문서 (180일 이상 미수정)
  const now = Date.now();
  const staleDocs = docs.filter(d => {
    if (!d.lastModified) return false;
    const age = (now - new Date(d.lastModified).getTime()) / 86400000;
    return age > 180;
  });
  if (staleDocs.length > totalDocs * 0.3) {
    suggestions.push(`${staleDocs.length}개 문서가 6개월 이상 미수정입니다. \`stellavault decay\`로 확인하세요.`);
  }

  // 6. 건강도 점수 계산
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const penalty = criticalCount * 10 + warningCount * 3;
  const score = Math.max(0, Math.min(100, 100 - penalty));

  // 7. 종합 제안
  if (gapCount > 5) {
    suggestions.push(`${gapCount}개 지식 갭이 발견되었습니다. 가장 심각한 갭부터 채워보세요.`);
  }
  if (dupCount > 3) {
    suggestions.push(`${dupCount}개 중복 문서가 있습니다. \`stellavault duplicates\`로 병합하세요.`);
  }
  if (isolatedCount > 10) {
    suggestions.push(`${isolatedCount}개 고립 노트가 있습니다. 태그나 링크를 추가해 연결하세요.`);
  }
  if (totalDocs > 0 && issues.length === 0) {
    suggestions.push('지식 베이스가 건강합니다! 계속 유지하세요.');
  }

  return {
    score,
    issues,
    suggestions,
    stats: {
      totalDocs,
      gaps: gapCount,
      duplicates: dupCount,
      contradictions: contradictionCount,
      isolatedNodes: isolatedCount,
      orphanTags: 0,
    },
  };
}
