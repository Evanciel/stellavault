import type { VectorStore } from '../../store/types.js';

export const getDocumentToolDef = {
  name: 'get-document',
  description: '문서 ID 또는 파일 경로로 전체 문서 내용을 가져옵니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: '문서 ID 또는 파일 경로' },
    },
    required: ['id'],
  },
};

export async function handleGetDocument(store: VectorStore, args: { id: string }) {
  const doc = await store.getDocument(args.id);
  if (!doc) return { error: `Document not found: ${args.id}` };
  return {
    title: doc.title,
    filePath: doc.filePath,
    content: doc.content,
    tags: doc.tags,
    frontmatter: doc.frontmatter,
    lastModified: doc.lastModified,
  };
}
