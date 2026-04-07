// MCP Tool: generate-draft — Claude Code에서 직접 초안 생성
// Claude가 vault 컨텍스트를 받아 직접 글을 쓰도록 구조화된 재료를 반환
// 비용: $0 (이미 Claude Code 세션 안)

import type { SearchEngine } from '../../search/index.js';
import { scanRawDirectory, extractConcepts } from '../../intelligence/wiki-compiler.js';
import { loadConfig, DEFAULT_FOLDERS } from '../../config.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export function createGenerateDraftTool(searchEngine: SearchEngine, vaultPath: string) {
  return {
    name: 'generate-draft',
    description: 'Gather knowledge from your vault to write a draft. Returns structured context (notes, concepts, excerpts) so you can compose a blog post, report, or outline. Use this when the user asks you to "write a draft", "blog post from my notes", or "summarize my knowledge about X".',
    inputSchema: {
      type: 'object' as const,
      properties: {
        topic: {
          type: 'string',
          description: 'Topic or keyword to focus on. Leave empty for all knowledge.',
        },
        format: {
          type: 'string',
          enum: ['blog', 'report', 'outline'],
          description: 'Desired output format (default: blog)',
        },
        maxSources: {
          type: 'number',
          description: 'Maximum number of source documents to include (default: 10)',
        },
      },
    },

    handler: async (args: { topic?: string; format?: string; maxSources?: number }) => {
      const { topic, format = 'blog', maxSources = 10 } = args;
      const config = loadConfig();
      const folders = config.folders ?? DEFAULT_FOLDERS;

      // 1. 토픽 기반 검색 (있으면)
      let searchResults: Array<{ title: string; content: string; filePath: string; score: number }> = [];
      if (topic) {
        const results = await searchEngine.search({ query: topic, limit: maxSources });
        searchResults = results.map(r => ({
          title: r.document?.title ?? 'Untitled',
          content: r.chunk?.content ?? '',
          filePath: r.document?.filePath ?? '',
          score: r.score ?? 0,
        }));
      }

      // 2. vault 전체 스캔 (검색 결과가 부족하면)
      const allDocs: Array<{ title: string; content: string; tags: string[]; filePath: string }> = [];
      for (const dir of [folders.fleeting, folders.literature, folders.permanent, folders.wiki]) {
        const fullDir = resolve(vaultPath, dir);
        if (existsSync(fullDir)) {
          const docs = scanRawDirectory(fullDir);
          allDocs.push(...docs);
        }
      }

      // 토픽 필터
      const relevantDocs = topic
        ? allDocs.filter(d =>
            d.title.toLowerCase().includes(topic.toLowerCase()) ||
            d.tags.some(t => t.toLowerCase().includes(topic.toLowerCase())) ||
            d.content.toLowerCase().includes(topic.toLowerCase())
          )
        : allDocs;

      // 3. 개념 추출
      const concepts = extractConcepts(relevantDocs.length > 0 ? relevantDocs : allDocs);
      const topConcepts = [...concepts.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 8)
        .map(([name, docs]) => ({ name, documentCount: docs.length }));

      // 4. 발췌 준비
      const excerpts = (searchResults.length > 0 ? searchResults : relevantDocs.slice(0, maxSources))
        .map(doc => {
          const body = doc.content
            .replace(/^---[\s\S]*?---\n?/, '') // frontmatter 제거
            .replace(/^#+\s+.+\n/m, '')        // 첫 heading 제거
            .trim()
            .slice(0, 500);
          return {
            title: doc.title,
            excerpt: body,
            filePath: doc.filePath,
          };
        })
        .filter(e => e.excerpt.length > 20);

      // 5. 구조화된 컨텍스트 반환
      const context = {
        topic: topic ?? 'All Knowledge',
        format,
        totalDocuments: relevantDocs.length || allDocs.length,
        concepts: topConcepts,
        sources: excerpts,
        instruction: `Use the sources above to write a ${format}. Rules:
- Only use information from the provided sources
- Cite sources using [[title]] wikilink format
- Write in the same language as the source material
- Add your analysis connecting ideas across sources
- Format: ${format === 'blog' ? 'Engaging blog post with intro, body sections, conclusion' : format === 'report' ? 'Formal report with executive summary, sections, conclusion' : 'Hierarchical outline with numbered sections'}`,
      };

      const text = `# Draft Context: ${context.topic}

## Format: ${format}
## Sources: ${context.totalDocuments} documents, ${excerpts.length} excerpts

## Key Concepts
${topConcepts.map(c => `- **${c.name}** (${c.documentCount} documents)`).join('\n')}

## Source Excerpts

${excerpts.map(e => `### ${e.title}
> ${e.excerpt}
`).join('\n')}

## Instructions
${context.instruction}

---
Please write the ${format} draft based on the context above. Save the result to the vault's _drafts/ folder.`;

      return {
        content: [{ type: 'text' as const, text }],
      };
    },
  };
}
