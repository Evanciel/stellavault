// AI Learning Path Generator (F-A11)
// Analyzes decay + gaps + relationships to recommend what to review/learn next

import type { DecayReport, DecayState } from './types.js';

export interface LearningItem {
  documentId: string;
  title: string;
  reason: string;
  priority: 'critical' | 'important' | 'suggested';
  score: number; // 0-100, higher = more urgent
  category: 'review' | 'explore' | 'bridge';
}

export interface LearningPath {
  items: LearningItem[];
  summary: {
    reviewCount: number;
    exploreCount: number;
    bridgeCount: number;
    estimatedMinutes: number;
  };
  generatedAt: string;
}

export interface LearningPathInput {
  decayReport: DecayReport;
  gaps?: Array<{ clusterA: string; clusterB: string; severity: string; suggestedTopic: string }>;
  recentSearches?: string[];
}

export function generateLearningPath(input: LearningPathInput, limit = 15): LearningPath {
  const items: LearningItem[] = [];

  // 1. Review: decaying notes (highest priority)
  if (input.decayReport.topDecaying) {
    for (const d of input.decayReport.topDecaying) {
      const r = d.retrievability ?? 0;
      const urgency = (1 - r) * 100;
      items.push({
        documentId: d.documentId,
        title: d.title,
        reason: r < 0.3
          ? `Critical: ${Math.round(r * 100)}% retrievability, ${d.daysSinceAccess}d since last access`
          : `Fading: ${Math.round(r * 100)}% retrievability, review to strengthen memory`,
        priority: r < 0.3 ? 'critical' : r < 0.5 ? 'important' : 'suggested',
        score: Math.round(urgency),
        category: 'review',
      });
    }
  }

  // 2. Bridge: knowledge gaps
  if (input.gaps) {
    for (const gap of input.gaps) {
      const severityScore = gap.severity === 'high' ? 80 : gap.severity === 'medium' ? 60 : 40;
      items.push({
        documentId: '',
        title: gap.suggestedTopic || `${gap.clusterA} × ${gap.clusterB}`,
        reason: `Gap between "${gap.clusterA}" and "${gap.clusterB}" — creating a bridge note strengthens your knowledge network`,
        priority: gap.severity === 'high' ? 'important' : 'suggested',
        score: severityScore,
        category: 'bridge',
      });
    }
  }

  // Sort by score descending
  items.sort((a, b) => b.score - a.score);

  const selected = items.slice(0, limit);
  const reviewCount = selected.filter(i => i.category === 'review').length;
  const exploreCount = selected.filter(i => i.category === 'explore').length;
  const bridgeCount = selected.filter(i => i.category === 'bridge').length;

  return {
    items: selected,
    summary: {
      reviewCount,
      exploreCount,
      bridgeCount,
      estimatedMinutes: reviewCount * 3 + exploreCount * 5 + bridgeCount * 8,
    },
    generatedAt: new Date().toISOString(),
  };
}
