// MCP Tool: ask — Q&A with auto-filing to vault

import type { SearchEngine } from '../../search/index.js';
import { askVault } from '../../intelligence/ask-engine.js';

export function createAskTool(searchEngine: SearchEngine, vaultPath: string) {
  return {
    name: 'ask',
    description: 'Ask a question about your knowledge base. Searches vault, composes a structured answer with sources, and optionally saves the answer as a new note in your vault.',
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
      const result = await askVault(searchEngine, args.question, {
        limit: 10,
        save: args.save ?? false,
        vaultPath,
      });

      const text = [
        result.answer,
        '',
        result.savedTo ? `Saved to: ${result.savedTo}` : '',
        '',
        `Sources: ${result.sources.length} documents found`,
      ].filter(Boolean).join('\n');

      return {
        content: [{ type: 'text' as const, text }],
      };
    },
  };
}
