// Design Ref: F15 — 코드-지식 링커 MCP tool
// Plan SC: SC-03 코드 파일에서 관련 노트 매칭

import type { SearchEngine } from '../../search/index.js';
import { linkCodeToKnowledge } from '../../intelligence/code-linker.js';

export function createLinkCodeTool(searchEngine: SearchEngine) {
  return {
    name: 'link-code',
    description: 'Find knowledge notes related to a code file. Extracts keywords from file path and content, then searches the knowledge base.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: {
          type: 'string' as const,
          description: 'Path to the code file (e.g., src/auth/middleware.ts)',
        },
        content: {
          type: 'string' as const,
          description: 'Optional: code file content for deeper keyword extraction',
        },
        limit: {
          type: 'number' as const,
          description: 'Max related notes to return (default: 5)',
        },
      },
      required: ['filePath'] as const,
    },
    handler: async (args: { filePath: string; content?: string; limit?: number }) => {
      const result = await linkCodeToKnowledge(
        searchEngine,
        args.filePath,
        args.content,
        args.limit ?? 5,
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            filePath: result.filePath,
            extractedKeywords: result.keywords,
            relatedNotes: result.relatedNotes,
            summary: result.relatedNotes.length > 0
              ? `"${result.filePath}" 관련 노트 ${result.relatedNotes.length}개 발견. 최상위: "${result.relatedNotes[0].title}"`
              : `"${result.filePath}"에 대한 관련 노트를 찾지 못했습니다.`,
          }, null, 2),
        }],
      };
    },
  };
}
