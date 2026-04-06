// stellavault autopilot — 자율형 지식 플라이휠
// ingest(inbox) → compile → lint → index → 반복

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, compileWiki, lintKnowledge, getInboxItems, archiveFile } from '@stellavault/core';
import { resolve, join } from 'node:path';

export async function autopilotCommand(options: { once?: boolean }) {
  const config = loadConfig();
  const vaultPath = config.vaultPath;

  console.log(chalk.bold('\n  ✦ Stellavault Autopilot'));
  console.log(chalk.dim('  Knowledge flywheel: inbox → compile → lint → repeat\n'));

  // Step 1: Inbox 확인
  console.log(chalk.cyan('Step 1/4: Checking inbox...'));
  const inbox = getInboxItems(vaultPath);

  if (inbox.length === 0) {
    console.log(chalk.dim('  No new items in raw/ folder.'));
  } else {
    console.log(chalk.green(`  ${inbox.length} new items found.`));
    for (const item of inbox.slice(0, 5)) {
      console.log(chalk.dim(`    - ${item.title} (${item.wordCount} words)`));
    }
    if (inbox.length > 5) console.log(chalk.dim(`    ... and ${inbox.length - 5} more`));
  }

  // Step 2: Compile
  console.log(chalk.cyan('\nStep 2/4: Compiling wiki...'));
  const rawPath = resolve(vaultPath, 'raw');
  const wikiPath = resolve(vaultPath, '_wiki');

  const compileResult = compileWiki(rawPath, wikiPath);
  if (compileResult.rawDocCount > 0) {
    console.log(chalk.green(`  Compiled ${compileResult.rawDocCount} raw → ${compileResult.wikiArticles.length} wiki articles`));
    console.log(chalk.dim(`  Concepts: ${compileResult.concepts.length}`));

    // Archive processed raw files
    for (const item of inbox) {
      try {
        archiveFile(resolve(vaultPath, 'raw', item.filePath));
      } catch { /* skip */ }
    }
    console.log(chalk.dim(`  Archived ${inbox.length} processed items.`));
  } else {
    console.log(chalk.dim('  No raw documents to compile.'));
  }

  // Step 3: Lint
  console.log(chalk.cyan('\nStep 3/4: Running health check...'));
  const hub = createKnowledgeHub(config);
  await hub.store.initialize();

  const lintResult = await lintKnowledge(hub.store);
  const scoreColor = lintResult.score >= 80 ? chalk.green : lintResult.score >= 50 ? chalk.yellow : chalk.red;
  console.log(`  Health: ${scoreColor(lintResult.score + '/100')}`);

  const critical = lintResult.issues.filter(i => i.severity === 'critical').length;
  const warnings = lintResult.issues.filter(i => i.severity === 'warning').length;
  if (critical > 0) console.log(chalk.red(`  Critical: ${critical}`));
  if (warnings > 0) console.log(chalk.yellow(`  Warnings: ${warnings}`));

  // Step 4: Summary
  console.log(chalk.cyan('\nStep 4/4: Summary'));
  console.log(chalk.dim('─'.repeat(40)));
  console.log(`  Inbox processed: ${inbox.length}`);
  console.log(`  Wiki articles: ${compileResult.wikiArticles.length}`);
  console.log(`  Health score: ${lintResult.score}/100`);
  console.log(`  Issues: ${lintResult.issues.length}`);

  if (lintResult.suggestions.length > 0) {
    console.log(chalk.cyan('\n  Suggestions:'));
    for (const s of lintResult.suggestions.slice(0, 3)) {
      console.log(chalk.dim(`    → ${s}`));
    }
  }

  console.log(chalk.dim('\n─'.repeat(40)));
  console.log(chalk.green('  Autopilot complete.\n'));

  await hub.store.close?.();
}
