// Design Ref: §12.1 F14 — 결정 저널 (기술 결정 자동 기록)

import { writeFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SearchEngine } from '../../search/index.js';

export const logDecisionToolDef = {
  name: 'log-decision',
  description: '기술적 결정을 구조화하여 기록합니다. 나중에 "왜 이 선택을 했지?"에 답변할 수 있습니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: '결정 제목 (예: Zustand 대신 Jotai 선택)' },
      context: { type: 'string', description: '결정 배경/상황' },
      decision: { type: 'string', description: '선택한 내용' },
      alternatives: { type: 'array', items: { type: 'string' }, description: '고려한 대안들' },
      reasoning: { type: 'string', description: '선택 이유' },
      project: { type: 'string', description: '관련 프로젝트명' },
    },
    required: ['title', 'decision', 'reasoning'],
  },
};

export const findDecisionsToolDef = {
  name: 'find-decisions',
  description: '과거 기술 결정을 검색합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: '검색 쿼리' },
    },
    required: ['query'],
  },
};

export async function handleLogDecision(
  vaultPath: string,
  args: {
    title: string; context?: string; decision: string;
    alternatives?: string[]; reasoning: string; project?: string;
  },
) {
  const decisionsDir = join(vaultPath, 'decisions');
  mkdirSync(decisionsDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const slug = args.title.replace(/[^a-zA-Z가-힣0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 50);
  if (!slug) throw new Error('Invalid decision title');
  const fileName = `${date}-${slug}.md`;

  const content = [
    '---',
    `title: "${args.title}"`,
    `date: ${date}`,
    `project: "${args.project ?? ''}"`,
    'type: decision',
    '---',
    '',
    `# ${args.title}`,
    '',
    args.context ? `## 배경\n\n${args.context}\n` : '',
    `## 결정\n\n${args.decision}\n`,
    args.alternatives?.length
      ? `## 고려한 대안\n\n${args.alternatives.map(a => `- ${a}`).join('\n')}\n`
      : '',
    `## 이유\n\n${args.reasoning}\n`,
  ].filter(Boolean).join('\n');

  const filePath = resolve(decisionsDir, fileName);
  if (!filePath.startsWith(resolve(decisionsDir))) {
    throw new Error('Path traversal detected');
  }
  writeFileSync(filePath, content, 'utf-8');

  return { saved: filePath, fileName };
}

export async function handleFindDecisions(vaultPath: string, args: { query: string }) {
  const decisionsDir = join(vaultPath, 'decisions');
  if (!existsSync(decisionsDir)) return { decisions: [], message: 'No decisions directory' };

  const files = readdirSync(decisionsDir).filter(f => f.endsWith('.md'));
  const query = args.query.toLowerCase();

  const matches = files
    .map(f => {
      const content = readFileSync(join(decisionsDir, f), 'utf-8');
      const score = content.toLowerCase().includes(query) ? 1 : 0;
      return { file: f, content: content.slice(0, 300), score };
    })
    .filter(m => m.score > 0)
    .slice(0, 10);

  return { decisions: matches, total: files.length };
}
