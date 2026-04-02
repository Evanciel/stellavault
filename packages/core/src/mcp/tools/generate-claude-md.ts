// Design Ref: §12.1 F13 — CLAUDE.md 자동 생성기 (킬러 유스케이스)

import type { SearchEngine } from '../../search/index.js';
import type { VectorStore } from '../../store/types.js';

export const generateClaudeMdToolDef = {
  name: 'generate-claude-md',
  description: '프로젝트명을 기반으로 관련 지식(아키텍처, 패턴, 교훈, 결정사항)을 검색하여 CLAUDE.md 초안을 자동 생성합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectName: { type: 'string', description: '프로젝트명 또는 주요 키워드' },
      topics: {
        type: 'array',
        items: { type: 'string' },
        description: '추가 검색할 토픽 (예: ["인증", "배포", "성능"])',
      },
    },
    required: ['projectName'],
  },
};

export async function handleGenerateClaudeMd(
  searchEngine: SearchEngine,
  store: VectorStore,
  args: { projectName: string; topics?: string[] },
) {
  const { projectName, topics = [] } = args;

  // 프로젝트 관련 지식 검색 (여러 관점)
  const queries = [
    `${projectName} 아키텍처 설계`,
    `${projectName} 패턴 컨벤션`,
    `${projectName} 교훈 실수 주의사항`,
    `${projectName} 기술 스택 의존성`,
    ...topics.map(t => `${projectName} ${t}`),
  ];

  const allResults = new Map<string, { title: string; content: string; score: number; category: string }>();

  for (const query of queries) {
    const results = await searchEngine.search({ query, limit: 3 });
    const category = query.replace(projectName, '').trim();
    for (const r of results) {
      const key = r.chunk.id;
      if (!allResults.has(key) || (allResults.get(key)!.score < r.score)) {
        allResults.set(key, {
          title: `${r.document.title} §${r.chunk.heading}`,
          content: r.chunk.content.slice(0, 500),
          score: r.score,
          category,
        });
      }
    }
  }

  // 카테고리별 분류
  const sorted = [...allResults.values()].sort((a, b) => b.score - a.score);

  // CLAUDE.md 초안 생성
  const sections: string[] = [];
  sections.push(`# ${projectName} — CLAUDE.md`);
  sections.push('');
  sections.push('> 이 파일은 evan-knowledge-hub MCP에서 자동 생성되었습니다.');
  sections.push(`> 생성일: ${new Date().toISOString().slice(0, 10)}`);
  sections.push(`> 참조 지식: ${sorted.length}건`);
  sections.push('');

  // 아키텍처 섹션
  const archResults = sorted.filter(r => r.category.includes('아키텍처') || r.category.includes('설계'));
  if (archResults.length > 0) {
    sections.push('## 아키텍처 & 설계');
    sections.push('');
    for (const r of archResults.slice(0, 3)) {
      sections.push(`### ${r.title}`);
      sections.push(r.content.trim());
      sections.push('');
    }
  }

  // 패턴/컨벤션 섹션
  const patternResults = sorted.filter(r => r.category.includes('패턴') || r.category.includes('컨벤션'));
  if (patternResults.length > 0) {
    sections.push('## 코딩 패턴 & 컨벤션');
    sections.push('');
    for (const r of patternResults.slice(0, 3)) {
      sections.push(`### ${r.title}`);
      sections.push(r.content.trim());
      sections.push('');
    }
  }

  // 교훈 섹션
  const lessonResults = sorted.filter(r => r.category.includes('교훈') || r.category.includes('실수'));
  if (lessonResults.length > 0) {
    sections.push('## 교훈 & 주의사항');
    sections.push('');
    for (const r of lessonResults.slice(0, 5)) {
      sections.push(`- **${r.title}**: ${r.content.slice(0, 200).replace(/\n/g, ' ').trim()}`);
    }
    sections.push('');
  }

  // 기타 관련 지식
  const otherResults = sorted.filter(r =>
    !r.category.includes('아키텍처') && !r.category.includes('설계') &&
    !r.category.includes('패턴') && !r.category.includes('교훈') && !r.category.includes('실수')
  );
  if (otherResults.length > 0) {
    sections.push('## 관련 지식');
    sections.push('');
    for (const r of otherResults.slice(0, 5)) {
      sections.push(`- **${r.title}** (score: ${r.score.toFixed(3)})`);
    }
    sections.push('');
  }

  const claudeMd = sections.join('\n');

  return {
    content: claudeMd,
    stats: {
      queriesRun: queries.length,
      uniqueResults: sorted.length,
      sections: ['아키텍처', '패턴', '교훈', '관련 지식'].filter((_, i) =>
        [archResults, patternResults, lessonResults, otherResults][i].length > 0
      ),
    },
  };
}
