// Design Ref: stellavault clip — 웹 페이지/YouTube를 Obsidian에 클리핑

import chalk from 'chalk';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, assertPublicUrl } from '@stellavault/core';

export async function clipCommand(url: string, options: { folder?: string }) {
  if (!url) {
    console.error(chalk.red('❌ Please provide a URL: stellavault clip <url>'));
    process.exit(1);
  }

  const config = loadConfig();
  const vaultPath = config.vaultPath;
  if (!vaultPath) {
    console.error(chalk.red('❌ vaultPath not configured'));
    process.exit(1);
  }

  const folder = options.folder ?? '06_Research/clips';
  const targetDir = join(vaultPath, folder);
  mkdirSync(targetDir, { recursive: true });

  console.error(chalk.dim(`📎 Clipping: ${url}`));

  // SSRF 방지: resolve-then-check-IP (core assertPublicUrl) — clip도 ingest-by-URL 클래스(임의 사용자 URL fetch).
  // rebinding/encoding/IPv6/메타데이터(169.254) 방어. clip은 기존에 가드가 전혀 없었음.
  try {
    await assertPublicUrl(url);
  } catch {
    console.error(chalk.yellow('Private/local or non-public URLs are not allowed for security.'));
    process.exit(1);
  }

  try {
    // URL 유형 감지
    const isYouTube = /youtube\.com\/watch|youtu\.be\//.test(url);

    let title: string;
    let content: string;

    if (isYouTube) {
      // YouTube — 메타데이터 + 설명 추출
      const result = await clipYouTube(url);
      title = result.title;
      content = result.content;
    } else {
      // 일반 웹페이지 — HTML → Markdown
      const result = await clipWebPage(url);
      title = result.title;
      content = result.content;
    }

    // 파일명 생성 (안전한 문자만)
    const safeTitle = title
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

    const date = new Date().toISOString().slice(0, 10);
    const fileName = `${date} ${safeTitle}.md`;
    const filePath = join(targetDir, fileName);

    // Frontmatter + 내용 조합
    const md = [
      '---',
      `title: "${safeTitle}"`,
      `source: "${url}"`,
      `clipped: ${date}`,
      `tags: [clip${isYouTube ? ', youtube' : ''}]`,
      '---',
      '',
      `# ${safeTitle}`,
      '',
      `> Source: ${url}`,
      `> Clipped: ${date}`,
      '',
      content,
    ].join('\n');

    writeFileSync(filePath, md, 'utf-8');

    console.log(chalk.green(`✅ Saved: ${fileName}`));
    console.log(chalk.dim(`   → ${filePath}`));
    console.log(chalk.dim('   💡 Run stellavault index to make it searchable'));
  } catch (err) {
    console.error(chalk.red(`❌ Clip failed: ${(err as Error).message}`));
    process.exit(1);
  }
}

async function clipWebPage(url: string): Promise<{ title: string; content: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 stellavault-clipper/1.0' },
  });
  const html = await res.text();

  // 제목 추출
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

  // HTML → 간단한 마크다운 변환
  let content = html
    // 스크립트/스타일 제거
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // 헤딩
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    // 단락/줄바꿈
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // 링크
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    // 리스트
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    // 강조
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    // 코드
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n')
    // 나머지 태그 제거
    .replace(/<[^>]+>/g, '')
    // HTML 엔티티
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // 다중 줄바꿈 정리
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 너무 길면 자르기
  if (content.length > 10000) {
    content = content.slice(0, 10000) + '\n\n...(truncated)';
  }

  return { title, content };
}

async function clipYouTube(url: string): Promise<{ title: string; content: string }> {
  // YouTube 페이지에서 메타데이터 추출
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 stellavault-clipper/1.0' },
  });
  const html = await res.text();

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = (titleMatch ? titleMatch[1] : 'YouTube Video')
    .replace(/ - YouTube$/, '')
    .trim();

  // 비디오 설명 추출 시도
  const descMatch = html.match(/"shortDescription":"([\s\S]*?)"/);
  const description = descMatch
    ? descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').slice(0, 3000)
    : '(No description)';

  const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]+)/)?.[1] ?? '';

  const content = [
    `![thumbnail](https://img.youtube.com/vi/${videoId}/maxresdefault.jpg)`,
    '',
    '## Description',
    '',
    description,
    '',
    `## Links`,
    '',
    `- [YouTube](${url})`,
    videoId ? `- [Embed](https://www.youtube.com/embed/${videoId})` : '',
  ].filter(Boolean).join('\n');

  return { title, content };
}
