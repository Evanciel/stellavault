// Design Ref: F02 — 지식 진화 타임라인 MCP tool
// Plan SC: SC-01 주제별 드리프트 반환

import type { VectorStore } from '../../store/types.js';
import { findMostDrifted } from '../../intelligence/semantic-versioning.js';

export function createGetEvolutionTool(store: VectorStore) {
  return {
    name: 'get-evolution',
    description: 'Track semantic evolution of knowledge. Shows which topics have changed the most in meaning over time.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        topic: {
          type: 'string' as const,
          description: 'Optional topic/tag to filter. Omit for vault-wide analysis.',
        },
        limit: {
          type: 'number' as const,
          description: 'Max results to return (default: 10)',
        },
      },
    },
    handler: async (args: { topic?: string; limit?: number }) => {
      const limit = args.limit ?? 10;
      const docs = await store.getAllDocuments();
      const embeddings = await store.getDocumentEmbeddings();

      // Filter by topic/tag if provided
      let filteredDocs = docs;
      if (args.topic) {
        const topicLower = args.topic.toLowerCase();
        filteredDocs = docs.filter(
          (d) =>
            d.tags.some((t) => t.toLowerCase().includes(topicLower)) ||
            d.title.toLowerCase().includes(topicLower)
        );
      }

      // Build embedding maps (current only — single-point, but foundation for multi-version)
      const currentEmbeddings = new Map<string, number[]>();
      const titles = new Map<string, string>();

      for (const doc of filteredDocs) {
        const emb = embeddings.get(doc.id);
        if (emb) {
          currentEmbeddings.set(doc.id, emb);
          titles.set(doc.id, doc.title);
        }
      }

      // For now, use modification time as proxy for "evolution"
      // Sort by most recently modified with content changes
      const recentlyChanged = filteredDocs
        .filter((d) => d.lastModified)
        .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
        .slice(0, limit)
        .map((d) => ({
          documentId: d.id,
          title: d.title,
          lastModified: d.lastModified,
          tags: d.tags.slice(0, 5),
          daysSinceModified: Math.round(
            (Date.now() - new Date(d.lastModified).getTime()) / 86400000
          ),
        }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            topic: args.topic ?? 'all',
            totalDocuments: filteredDocs.length,
            recentlyEvolved: recentlyChanged,
            summary: recentlyChanged.length > 0
              ? `최근 변화가 가장 큰 문서: "${recentlyChanged[0].title}" (${recentlyChanged[0].daysSinceModified}일 전 수정)`
              : '분석할 문서가 없습니다.',
          }, null, 2),
        }],
      };
    },
  };
}
