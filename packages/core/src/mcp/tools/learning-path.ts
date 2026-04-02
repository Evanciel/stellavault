// MCP Tool: get-learning-path (F-A11)

import type { VectorStore } from '../../store/types.js';
import { DecayEngine } from '../../intelligence/decay-engine.js';
import { detectKnowledgeGaps } from '../../intelligence/gap-detector.js';
import { generateLearningPath } from '../../intelligence/learning-path.js';

export function createLearningPathTool(store: VectorStore) {
  return {
    name: 'get-learning-path',
    description: 'Generate a personalized learning path based on knowledge decay and gaps. Returns prioritized list of what to review, explore, or bridge.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max items to return (default: 10)' },
      },
    },
    async handler(args: { limit?: number }) {
      const limit = args.limit ?? 10;
      const db = store.getDb() as any;
      if (!db) return { content: [{ type: 'text' as const, text: 'Database not available' }] };

      const decayEngine = new DecayEngine(db);
      const decayReport = await decayEngine.computeAll();

      let gaps: any[] = [];
      try {
        const gapReport = await detectKnowledgeGaps(store);
        gaps = gapReport.gaps ?? [];
      } catch { /* ignore */ }

      const path = generateLearningPath({ decayReport, gaps }, limit);

      const lines = [
        `🎯 Learning Path (${path.items.length} items, ~${path.summary.estimatedMinutes}min)`,
        '',
      ];

      for (const item of path.items) {
        const icon = item.category === 'review' ? '📖' : item.category === 'bridge' ? '🌉' : '🔭';
        lines.push(`${icon} [${item.priority}] ${item.title} (${item.score}pt)`);
        lines.push(`   ${item.reason}`);
      }

      if (path.items.length === 0) {
        lines.push('All clear! Knowledge is in great shape.');
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  };
}
