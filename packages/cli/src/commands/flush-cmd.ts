// stellavault flush — Daily Logs → Wiki 플러시 (카파시의 Flush Process)
// Raw daily logs에서 개념/연결 추출 → wiki 갱신
// "소스 코드를 실행 파일로 컴파일하듯, 원시 데이터를 구조화된 지식으로 변환"

import chalk from 'chalk';
import { loadConfig } from '@stellavault/core';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

export async function flushCommand() {
  const config = loadConfig();
  if (!config.vaultPath) {
    console.error(chalk.red('No vault configured. Run `stellavault init` first.'));
    process.exit(1);
  }

  const folders = config.folders;
  const logDir = resolve(config.vaultPath, folders.fleeting, '_daily-logs');

  if (!existsSync(logDir)) {
    console.log(chalk.yellow('No daily logs found. Use `stellavault session-save` or let Claude Code hooks capture sessions.'));
    return;
  }

  // 1. Daily logs 수집
  const logFiles = readdirSync(logDir).filter(f => f.startsWith('daily-log-') && f.endsWith('.md'));
  if (logFiles.length === 0) {
    console.log(chalk.yellow('No daily log files found.'));
    return;
  }

  console.log(chalk.dim(`Found ${logFiles.length} daily logs`));

  // 2. 모든 로그에서 세션 요약 추출
  let totalSessions = 0;
  const allContent: string[] = [];

  for (const file of logFiles) {
    const content = readFileSync(join(logDir, file), 'utf-8');
    const sessions = content.split(/^## Session/m).slice(1);
    totalSessions += sessions.length;
    allContent.push(content);
  }

  console.log(chalk.dim(`Total sessions: ${totalSessions}`));

  // 3. Compile: raw/ 전체 (daily-logs 포함) → wiki
  try {
    const { compileWiki } = await import('@stellavault/core/intelligence/wiki-compiler');
    const rawDir = resolve(config.vaultPath, folders.fleeting);
    const wikiDir = resolve(config.vaultPath, folders.wiki);

    const result = compileWiki(rawDir, wikiDir);

    console.log(chalk.green(`Flush complete!`));
    console.log(chalk.dim(`  Daily logs: ${logFiles.length} files, ${totalSessions} sessions`));
    console.log(chalk.dim(`  Wiki articles: ${result.wikiArticles.length}`));
    console.log(chalk.dim(`  Concepts extracted: ${result.concepts.length}`));
    if (result.concepts.length > 0) {
      console.log(chalk.dim(`  Top concepts: ${result.concepts.slice(0, 8).join(', ')}`));
    }
    console.log(chalk.dim(`  Index: ${result.indexFile}`));
  } catch (err) {
    console.error(chalk.red(`Flush failed: ${err instanceof Error ? err.message : 'unknown'}`));
    process.exit(1);
  }

  console.log(chalk.dim('  Tip: Run `stellavault lint` to check knowledge health'));
}
