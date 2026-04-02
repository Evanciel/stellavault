import type { SearchEngine } from '../../search/index.js';

export const searchToolDef = {
  name: 'search',
  description: '개인 지식 베이스에서 관련 문서/청크를 검색합니다. 자연어 쿼리와 키워드 모두 지원합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: '검색 쿼리 (자연어 또는 키워드)' },
      limit: { type: 'number', description: '반환할 결과 수 (기본: 5)' },
      tags: { type: 'array', items: { type: 'string' }, description: '태그 필터' },
    },
    required: ['query'],
  },
};

export async function handleSearch(
  searchEngine: SearchEngine,
  args: { query: string; limit?: number; tags?: string[] },
) {
  const results = await searchEngine.search({
    query: args.query,
    limit: args.limit ?? 5,
    tags: args.tags,
  });

  return results.map(r => ({
    title: r.document.title,
    filePath: r.document.filePath,
    heading: r.chunk.heading,
    content: r.chunk.content,
    score: Math.round(r.score * 1000) / 1000,
    tags: r.document.tags,
  }));
}
