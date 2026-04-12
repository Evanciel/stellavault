// Design Ref: stellavault duplicates — 중복/유사 노트 탐지 CLI

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, detectDuplicates } from '@stellavault/core';

export async function duplicatesCommand(options: { threshold?: string }) {
  const config = loadConfig();
  const hub = createKnowledgeHub(config);
  const threshold = parseFloat(options.threshold ?? '0.88');

  console.error(chalk.dim('⏳ Scanning for duplicates...'));
  await hub.store.initialize();
  await hub.embedder.initialize();

  const pairs = await detectDuplicates(hub.store, threshold, 20);

  if (pairs.length === 0) {
    console.log(chalk.green('\n✨ No duplicate notes found!'));
    return;
  }

  console.log(chalk.yellow(`\n🔍 Found ${pairs.length} similar note pairs (threshold: ${threshold})`));
  console.log(chalk.dim('─'.repeat(60)));

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const pct = Math.round(p.similarity * 100);
    const color = pct >= 95 ? chalk.red : chalk.yellow;

    console.log(`\n${chalk.bold(`[${i + 1}]`)} ${color(`${pct}% similar`)}`);
    console.log(`  A: ${chalk.cyan(p.docA.title)}`);
    console.log(`     ${chalk.dim(p.docA.filePath)}`);
    console.log(`  B: ${chalk.cyan(p.docB.title)}`);
    console.log(`     ${chalk.dim(p.docB.filePath)}`);
  }

  console.log(chalk.dim('\n💡 Merge or delete duplicates in Obsidian'));
}
