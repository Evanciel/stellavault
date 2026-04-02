import type { VectorStore } from '../../store/types.js';

export const listTopicsToolDef = {
  name: 'list-topics',
  description: '지식 베이스의 전체 토픽/태그 목록과 문서 수를 반환합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

export async function handleListTopics(store: VectorStore) {
  const topics = await store.getTopics();
  const stats = await store.getStats();
  return {
    topics,
    totalDocuments: stats.documentCount,
    totalChunks: stats.chunkCount,
  };
}
