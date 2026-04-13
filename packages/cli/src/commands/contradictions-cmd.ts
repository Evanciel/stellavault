// stellavault contradictions — detect contradicting statements (F-A12)

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub } from '@stellavault/core';
import { detectContradictions } from '@stellavault/core';
import type { CliCommand } from '../types.js';

export async function contradictionsCommand(_opts: Record<string, never>, cmd: CliCommand) {
  const globalOpts = cmd?.parent?.opts?.() ?? {};
  const jsonMode = globalOpts.json;
  const config = loadConfig();
  const hub = createKnowledgeHub(config);

  console.error(chalk.dim('Scanning for contradictions...'));
  await hub.store.initialize();
  await hub.embedder.initialize();

  const pairs = await detectContradictions(hub.store, 20);
  await hub.store.close();

  if (jsonMode) {
    console.log(JSON.stringify({ count: pairs.length, contradictions: pairs }, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold(`  ⚡ ${pairs.length} potential contradictions found`));
  console.log('');

  for (const p of pairs) {
    const confColor = p.confidence >= 0.8 ? chalk.red : p.confidence >= 0.6 ? chalk.yellow : chalk.dim;
    console.log(`  ${confColor(`${Math.round(p.confidence * 100)}%`)} ${chalk.dim(`[${p.type}]`)} ${chalk.bold(p.docA.title)} vs ${chalk.bold(p.docB.title)}`);
    console.log(`    A: ${chalk.dim(p.docA.statement.slice(0, 80))}`);
    console.log(`    B: ${chalk.dim(p.docB.statement.slice(0, 80))}`);
    console.log('');
  }

  if (pairs.length === 0) {
    console.log(chalk.green('  No contradictions detected. Your knowledge is consistent!'));
    console.log('');
  }
}
