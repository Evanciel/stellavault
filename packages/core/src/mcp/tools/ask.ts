// MCP Tool: ask — Q&A with auto-filing to vault

import type { SearchEngine } from '../../search/index.js';
import { askVault } from '../../intelligence/ask-engine.js';

export function createAskTool(searchEngine: SearchEngine, vaultPath: string) {
  return {
    name: 'ask',
    description: 'Ask a question about your knowledge base. Searches vault using hybrid AI search (BM25 + vector + RRF), returns structured results with sources. Use the results to compose your own AI-powered answer. Optionally saves as a new note.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string' as const,
          description: 'The question to ask about your knowledge',
        },
        save: {
          type: 'boolean' as const,
          description: 'Save the answer as a new note in the vault (default: false)',
        },
      },
      required: ['question'] as const,
    },
    handler: async (args: { question: string; save?: boolean }) => {
      if (!args.question || args.question.length > 2000) {
        return { content: [{ type: 'text' as const, text: 'Error: question is required and must be under 2000 characters.' }], isError: true };
      }
      const result = await askVault(searchEngine, args.question, {
        limit: 10,
        save: args.save ?? false,
        vaultPath,
      });

      const sourceList = result.sources.slice(0, 5).map((s, i) =>
        `${i + 1}. **${s.title}** (score: ${s.score})\n   > ${s.snippet.slice(0, 120)}...`
      ).join('\n');

      const text = [
        result.answer,
        '',
        '---',
        `### Sources (${result.sources.length} documents)`,
        sourceList,
        '',
        result.savedTo ? `Saved to: ${result.savedTo}` : '',
      ].filter(Boolean).join('\n');

      return {
        content: [{ type: 'text' as const, text }],
      };
    },
  };
}
