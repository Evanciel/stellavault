// Predictive Gap Analysis (F-A14)
// Based on graph topology, predict knowledge areas worth exploring

import type { VectorStore } from '../store/types.js';

export interface PredictedGap {
  topic: string;
  reason: string;
  confidence: number; // 0-1
  relatedTopics: string[];
  category: 'adjacent' | 'bridging' | 'deepening';
}

/**
 * Analyze graph topology to predict knowledge worth acquiring.
 * Uses degree centrality, cluster density, and tag co-occurrence.
 */
export async function predictKnowledgeGaps(
  store: VectorStore,
  limit = 10,
): Promise<PredictedGap[]> {
  const docs = await store.getAllDocuments();
  const topics = await store.getTopics();

  if (docs.length < 10) return [];

  const predictions: PredictedGap[] = [];

  // 1. Find isolated tags (topics that appear rarely and could be expanded)
  const topicCounts = new Map(topics.map(t => [t.topic, t.count]));
  const avgCount = topics.reduce((s, t) => s + t.count, 0) / (topics.length || 1);

  // Tags that appear 1-2 times — potential deepening opportunities
  const sparseTopics = topics.filter(t => t.count <= 2 && t.count > 0);
  for (const t of sparseTopics.slice(0, 5)) {
    predictions.push({
      topic: t.topic,
      reason: `Only ${t.count} note(s) on "${t.topic}" — deepening this area would strengthen your knowledge network`,
      confidence: 0.6,
      relatedTopics: findCoOccurring(t.topic, docs),
      category: 'deepening',
    });
  }

  // 2. Find tag pairs that never co-occur but are both frequent
  const frequentTopics = topics.filter(t => t.count >= avgCount).slice(0, 20);
  const coOccurrence = new Map<string, Set<string>>();

  for (const doc of docs) {
    for (const tagA of doc.tags) {
      if (!coOccurrence.has(tagA)) coOccurrence.set(tagA, new Set());
      for (const tagB of doc.tags) {
        if (tagA !== tagB) coOccurrence.get(tagA)!.add(tagB);
      }
    }
  }

  for (let i = 0; i < frequentTopics.length; i++) {
    for (let j = i + 1; j < frequentTopics.length; j++) {
      const a = frequentTopics[i].topic;
      const b = frequentTopics[j].topic;
      const aCoOccurs = coOccurrence.get(a) ?? new Set();

      if (!aCoOccurs.has(b)) {
        predictions.push({
          topic: `${a} × ${b}`,
          reason: `"${a}" (${frequentTopics[i].count} notes) and "${b}" (${frequentTopics[j].count} notes) are both well-known but never connected — bridging them could reveal insights`,
          confidence: 0.7,
          relatedTopics: [a, b],
          category: 'bridging',
        });
      }
    }
  }

  // 3. Adjacent topics — topics that co-occur with many of your topics but you don't have
  // (This would ideally use external knowledge, but we approximate with tag patterns)

  return predictions
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

function findCoOccurring(topic: string, docs: Array<{ tags: string[] }>): string[] {
  const coTopics = new Map<string, number>();
  for (const doc of docs) {
    if (doc.tags.includes(topic)) {
      for (const t of doc.tags) {
        if (t !== topic) coTopics.set(t, (coTopics.get(t) ?? 0) + 1);
      }
    }
  }
  return [...coTopics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
}
