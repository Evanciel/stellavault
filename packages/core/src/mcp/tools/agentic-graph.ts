// Agentic Graph Construction (P3-F23)
// AI가 MCP 세션 중 실시간으로 그래프 노드/엣지 생성

import type { VectorStore } from '../../store/types.js';
import type { Embedder } from '../../indexer/embedder.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createAgenticGraphTools(store: VectorStore, embedder: Embedder, vaultPath: string) {
  return [
    {
      name: 'create-knowledge-node',
      description: 'Create a wiki-quality knowledge note in the vault. Auto-finds related documents, generates backlinks, and adds concept tags. The note is saved with proper frontmatter and cross-references.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: 'Note title' },
          content: { type: 'string', description: 'Note content (markdown)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
          type: { type: 'string', description: 'Note type: note, decision, insight, summary, wiki' },
          folder: { type: 'string', description: 'Vault subfolder (default: 01_Knowledge)' },
          autoLink: { type: 'boolean', description: 'Auto-discover and add links to related notes (default: true)' },
        },
        required: ['title', 'content'],
      },
      async handler(args: { title: string; content: string; tags?: string[]; type?: string; folder?: string; autoLink?: boolean }) {
        const { title, content, tags = [], type = 'note', folder = '01_Knowledge', autoLink = true } = args;

        // 관련 문서 자동 탐색
        let relatedSection = '';
        if (autoLink) {
          try {
            const docs = await store.getAllDocuments();
            const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const related = docs
              .filter(d => {
                const dTitle = d.title.toLowerCase();
                return titleWords.some(w => dTitle.includes(w)) ||
                  tags.some(t => d.tags.includes(t));
              })
              .slice(0, 5);

            if (related.length > 0) {
              relatedSection = '\n\n## Related Notes\n' +
                related.map(r => `- [[${r.title}]]`).join('\n') +
                '\n';
            }
          } catch { /* skip auto-link on error */ }
        }

        // frontmatter 생성
        const date = new Date().toISOString().slice(0, 10);
        const fm = [
          '---',
          `title: "${title}"`,
          `type: ${type}`,
          `source: agent`,
          `tags: [${tags.map(t => `"${t}"`).join(', ')}]`,
          `created: ${date}`,
          `auto_generated: true`,
          '---',
        ].join('\n');

        const fullContent = `${fm}\n\n# ${title}\n\n${content}${relatedSection}`;

        // vault에 파일 저장 (path traversal 방지)
        const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const dir = join(vaultPath, folder);
        const filePath = join(dir, `${safeTitle}.md`);
        const resolvedPath = require('node:path').resolve(filePath);
        const resolvedVault = require('node:path').resolve(vaultPath);
        if (!resolvedPath.startsWith(resolvedVault)) {
          return { content: [{ type: 'text' as const, text: 'Error: invalid folder path.' }] };
        }

        mkdirSync(dir, { recursive: true });
        writeFileSync(filePath, fullContent, 'utf-8');

        const relatedCount = relatedSection ? relatedSection.split('\n').filter(l => l.startsWith('- ')).length : 0;
        return {
          content: [{
            type: 'text' as const,
            text: `Created wiki-quality note: "${title}" at ${folder}/${safeTitle}.md\nTags: ${tags.join(', ') || 'none'}\nType: ${type}\nAuto-linked: ${relatedCount} related notes\n\nThe note will appear in the graph after next index.`,
          }],
        };
      },
    },
    {
      name: 'create-knowledge-link',
      description: 'Create a link between two existing notes by adding a wiki-link reference. Strengthens connections in the knowledge graph.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceTitle: { type: 'string', description: 'Title of the source note' },
          targetTitle: { type: 'string', description: 'Title of the target note to link to' },
          context: { type: 'string', description: 'Why these notes are related (added as a comment)' },
        },
        required: ['sourceTitle', 'targetTitle'],
      },
      async handler(args: { sourceTitle: string; targetTitle: string; context?: string }) {
        const docs = await store.getAllDocuments();
        const source = docs.find(d => d.title.toLowerCase().includes(args.sourceTitle.toLowerCase()));

        if (!source) {
          return { content: [{ type: 'text' as const, text: `Source note "${args.sourceTitle}" not found.` }] };
        }

        // 소스 노트에 링크 추가
        const { readFileSync } = await import('node:fs');
        const fullPath = join(vaultPath, source.filePath);
        let existing = '';
        try { existing = readFileSync(fullPath, 'utf-8'); } catch { /* new file */ }

        const linkSection = `\n\n## Related\n\n- [[${args.targetTitle}]]${args.context ? ` — ${args.context}` : ''}\n`;
        writeFileSync(fullPath, existing + linkSection, 'utf-8');

        return {
          content: [{
            type: 'text' as const,
            text: `Linked "${source.title}" → "${args.targetTitle}"${args.context ? ` (${args.context})` : ''}`,
          }],
        };
      },
    },
  ];
}
