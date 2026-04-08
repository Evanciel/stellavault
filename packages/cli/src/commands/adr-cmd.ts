// stellavault adr — Architecture Decision Record 구조화 인제스트
// 의사결정 기록: 제목/맥락/옵션/결정/결과

import chalk from 'chalk';
import { loadConfig, ingest } from '@stellavault/core';

export async function adrCommand(title: string, options: { context?: string; options?: string; decision?: string; consequences?: string }) {
  if (!title) {
    console.error(chalk.yellow('Usage: stellavault adr "Decision Title" --context "..." --options "..." --decision "..." --consequences "..."'));
    process.exit(1);
  }

  const config = loadConfig();
  const now = new Date().toISOString().split('T')[0];

  const content = [
    `# ADR: ${title}`,
    '',
    `**Date:** ${now}`,
    `**Status:** Accepted`,
    '',
    '## Context',
    options.context ?? '<!-- Why is this decision needed? -->',
    '',
    '## Options Considered',
    options.options ?? '<!-- What alternatives were evaluated? -->',
    '',
    '## Decision',
    options.decision ?? '<!-- What was decided and why? -->',
    '',
    '## Consequences',
    options.consequences ?? '<!-- What are the implications? -->',
    '',
  ].join('\n');

  const result = ingest(config.vaultPath, {
    type: 'text',
    content,
    tags: ['adr', 'decision'],
    title: `ADR: ${title}`,
    stage: 'literature',
  }, config.folders);

  console.log(chalk.green(`ADR created: ${title}`));
  console.log(chalk.dim(`  Saved: ${result.savedTo}`));
  console.log(chalk.dim(`  Stage: literature`));
  console.log(chalk.dim(`  Tags: adr, decision`));
  console.log('');
  console.log(chalk.dim(`Find later: stellavault ask "why did we choose ${title}?"`));
}
