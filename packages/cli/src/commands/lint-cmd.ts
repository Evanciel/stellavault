// stellavault lint — 지식 건강 검사 CLI

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, lintKnowledge } from '@stellavault/core';

export async function lintCommand() {
  const config = loadConfig();
  const hub = createKnowledgeHub(config);

  console.error(chalk.dim('Scanning your knowledge base...'));
  await hub.store.initialize();

  const result = await lintKnowledge(hub.store);

  // 건강도 점수
  const scoreColor = result.score >= 80 ? chalk.green : result.score >= 50 ? chalk.yellow : chalk.red;
  console.log('');
  console.log(chalk.bold('Knowledge Health Report'));
  console.log('─'.repeat(40));
  console.log(`Score: ${scoreColor(result.score + '/100')}`);
  console.log(`Documents: ${result.stats.totalDocs}`);
  console.log('');

  // 이슈
  if (result.issues.length > 0) {
    const critical = result.issues.filter(i => i.severity === 'critical');
    const warnings = result.issues.filter(i => i.severity === 'warning');
    const info = result.issues.filter(i => i.severity === 'info');

    if (critical.length > 0) {
      console.log(chalk.red(`Critical: ${critical.length}`));
      for (const i of critical) {
        console.log(chalk.red(`  ✗ ${i.message}`));
        if (i.suggestion) console.log(chalk.dim(`    → ${i.suggestion}`));
      }
      console.log('');
    }

    if (warnings.length > 0) {
      console.log(chalk.yellow(`Warnings: ${warnings.length}`));
      for (const i of warnings.slice(0, 10)) {
        console.log(chalk.yellow(`  ! ${i.message}`));
        if (i.suggestion) console.log(chalk.dim(`    → ${i.suggestion}`));
      }
      if (warnings.length > 10) console.log(chalk.dim(`  ... and ${warnings.length - 10} more`));
      console.log('');
    }

    if (info.length > 0) {
      console.log(chalk.dim(`Info: ${info.length}`));
      for (const i of info.slice(0, 5)) {
        console.log(chalk.dim(`  ℹ ${i.message}`));
      }
      console.log('');
    }
  }

  // 제안
  if (result.suggestions.length > 0) {
    console.log(chalk.cyan('Suggestions:'));
    for (const s of result.suggestions) {
      console.log(`  → ${s}`);
    }
  }

  console.log('');
  await hub.store.close?.();
}
