// stellavault session-save — 세션 요약을 daily log로 자동 저장
// 카파시 아키텍처: 세션 종료 시 대화의 핵심 결정/교훈/실행항목을 캡처
// Claude Code hooks의 pre-compact/session-end에서 호출됨

import chalk from 'chalk';
import { loadConfig } from '@stellavault/core';
import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

export async function sessionSaveCommand(options: { summary?: string; decisions?: string; lessons?: string; actions?: string }) {
  const config = loadConfig();
  if (!config.vaultPath) {
    console.error(chalk.red('No vault configured. Run `stellavault init` first.'));
    process.exit(1);
  }

  const folders = config.folders;
  const logDir = resolve(config.vaultPath, folders.fleeting, '_daily-logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0];
  const logFile = join(logDir, `daily-log-${dateStr}.md`);

  // stdin에서 요약 읽기 (Claude Code hook에서 파이프로 전달)
  let summary = options.summary ?? '';
  if (!summary && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    summary = Buffer.concat(chunks).toString('utf-8').trim();
  }

  if (!summary) {
    // 대화형: 직접 입력
    console.log(chalk.dim('Enter session summary (Ctrl+D to finish):'));
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    summary = Buffer.concat(chunks).toString('utf-8').trim();
  }

  if (!summary) {
    console.error(chalk.yellow('No summary provided. Skipping.'));
    return;
  }

  // daily log 엔트리 구성
  const entry = [
    '',
    `## Session — ${timeStr}`,
    '',
    '### Summary',
    summary,
    '',
  ];

  if (options.decisions) {
    entry.push('### Decisions', options.decisions, '');
  }
  if (options.lessons) {
    entry.push('### Lessons Learned', options.lessons, '');
  }
  if (options.actions) {
    entry.push('### Action Items', options.actions, '');
  }

  entry.push('---', '');

  // 파일이 없으면 헤더 생성, 있으면 append
  if (!existsSync(logFile)) {
    const header = [
      '---',
      `title: "Daily Log — ${dateStr}"`,
      'type: fleeting',
      'tags: ["daily-log", "session"]',
      `created: ${now.toISOString()}`,
      '---',
      '',
      `# Daily Log — ${dateStr}`,
      '',
    ].join('\n');
    writeFileSync(logFile, header + entry.join('\n'), 'utf-8');
  } else {
    appendFileSync(logFile, entry.join('\n'), 'utf-8');
  }

  console.log(chalk.green(`Session saved to daily log: ${dateStr}`));
  console.log(chalk.dim(`  File: ${logFile}`));
  console.log(chalk.dim(`  Time: ${timeStr}`));
  console.log(chalk.dim(`  Words: ${summary.split(/\s+/).length}`));

  // 자동 compile 트리거
  try {
    const { compileWiki } = await import('@stellavault/core/intelligence/wiki-compiler');
    const rawDir = resolve(config.vaultPath, folders.fleeting);
    const wikiDir = resolve(config.vaultPath, folders.wiki);
    compileWiki(rawDir, wikiDir);
    console.log(chalk.dim('  Wiki: auto-compiled'));
  } catch { /* compile 실패해도 저장은 성공 */ }
}
