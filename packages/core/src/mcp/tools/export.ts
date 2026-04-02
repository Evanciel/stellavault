// Design Ref: §12.1 F20 — 지식 내보내기 포맷 (락인 방지)

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { VectorStore } from '../../store/types.js';

const ALLOWED_EXPORT_DIRS = [
  resolve(homedir(), '.stellavault'),
  resolve('.'),
];

function validateExportPath(outputPath: string): string {
  const resolved = resolve(outputPath);
  const isAllowed = ALLOWED_EXPORT_DIRS.some(dir => resolved.startsWith(resolve(dir)));
  if (!isAllowed) {
    throw new Error(`Export path must be within current directory or ~/.stellavault/. Got: ${resolved}`);
  }
  return resolved;
}

export const exportToolDef = {
  name: 'export',
  description: '벡터 DB의 문서와 메타데이터를 JSON 파일로 내보냅니다. 다른 도구로 이전 가능.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      outputPath: { type: 'string', description: '출력 파일 경로 (예: ./export.json)' },
      format: { type: 'string', enum: ['json', 'csv'], description: '출력 포맷 (기본: json)' },
    },
    required: ['outputPath'],
  },
};

export async function handleExport(
  store: VectorStore,
  args: { outputPath: string; format?: string },
) {
  const docs = await store.getAllDocuments();
  const stats = await store.getStats();
  const topics = await store.getTopics();

  const safePath = validateExportPath(args.outputPath);
  mkdirSync(dirname(safePath), { recursive: true });

  if (args.format === 'csv') {
    const header = 'id,filePath,title,tags,lastModified,contentHash';
    const rows = docs.map(d =>
      `"${d.id}","${d.filePath}","${d.title.replace(/"/g, '""')}","${d.tags.join(';')}","${d.lastModified}","${d.contentHash}"`
    );
    writeFileSync(safePath, [header, ...rows].join('\n'), 'utf-8');
  } else {
    const exported = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      stats,
      topics,
      documents: docs.map(d => ({
        id: d.id,
        filePath: d.filePath,
        title: d.title,
        tags: d.tags,
        frontmatter: d.frontmatter,
        lastModified: d.lastModified,
        contentLength: d.content.length,
      })),
    };
    writeFileSync(safePath, JSON.stringify(exported, null, 2), 'utf-8');
  }

  return { exported: docs.length, path: safePath, format: args.format ?? 'json' };
}
