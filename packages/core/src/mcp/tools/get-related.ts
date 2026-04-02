import type { SearchEngine } from '../../search/index.js';
import type { VectorStore } from '../../store/types.js';

export const getRelatedToolDef = {
  name: 'get-related',
  description: '특정 문서와 의미적으로 관련된 문서들을 반환합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: '기준 문서 ID 또는 파일 경로' },
      limit: { type: 'number', description: '반환할 관련 문서 수 (기본: 5)' },
    },
    required: ['id'],
  },
};

export async function handleGetRelated(
  store: VectorStore,
  searchEngine: SearchEngine,
  args: { id: string; limit?: number },
) {
  const doc = await store.getDocument(args.id);
  if (!doc) return { error: `Document not found: ${args.id}` };

  // 문서 제목+내용 일부를 쿼리로 사용하여 관련 문서 검색
  const query = `${doc.title} ${doc.content.slice(0, 200)}`;
  const results = await searchEngine.search({
    query,
    limit: (args.limit ?? 5) + 1, // 자기 자신 제외용 +1
  });

  return results
    .filter(r => r.document.id !== args.id)
    .slice(0, args.limit ?? 5)
    .map(r => ({
      title: r.document.title,
      filePath: r.document.filePath,
      score: Math.round(r.score * 1000) / 1000,
      tags: r.document.tags,
    }));
}
