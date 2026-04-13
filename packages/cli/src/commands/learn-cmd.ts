// stellavault learn — AI learning path recommendations (F-A11)

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, DecayEngine, detectKnowledgeGaps, generateLearningPath } from '@stellavault/core';
import type { KnowledgeGap } from '@stellavault/core';
import type { CliCommand } from '../types.js';

export async function learnCommand(_opts: Record<string, never>, cmd: CliCommand) {
  const globalOpts = cmd?.parent?.opts?.() ?? {};
  const jsonMode = globalOpts.json;
  const config = loadConfig();
  const hub = createKnowledgeHub(config);

  await hub.store.initialize();
  await hub.embedder.initialize();

  const db = hub.store.getDb() as any;
  if (!db) { console.error(chalk.red('Cannot access database')); process.exit(1); }

  const decayEngine = new DecayEngine(db);
  const decayReport = await decayEngine.computeAll();

  let gaps: KnowledgeGap[] = [];
  try {
    const gapReport = await detectKnowledgeGaps(hub.store);
    gaps = gapReport.gaps ?? [];
  } catch { /* gaps may fail without enough data */ }

  const path = generateLearningPath({ decayReport, gaps }, 15);
  await hub.store.close();

  if (jsonMode) {
    console.log(JSON.stringify(path, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold('  🎯 Your Learning Path'));
  console.log(chalk.dim(`  ${path.summary.reviewCount} to review · ${path.summary.bridgeCount} gaps to bridge · ~${path.summary.estimatedMinutes}min`));
  console.log('');

  for (const item of path.items) {
    const icon = item.category === 'review' ? '📖' : item.category === 'bridge' ? '🌉' : '🔭';
    const prioColor = item.priority === 'critical' ? chalk.red : item.priority === 'important' ? chalk.yellow : chalk.dim;
    const prioLabel = prioColor(item.priority.toUpperCase());

    console.log(`  ${icon} ${prioLabel} ${chalk.bold(item.title)} ${chalk.dim(`(${item.score}pt)`)}`);
    console.log(`     ${chalk.dim(item.reason)}`);
  }

  if (path.items.length === 0) {
    console.log(chalk.green('  All clear! Your knowledge is in great shape.'));
  }

  console.log('');
  console.log(chalk.dim('  💡 stellavault review — start reviewing decaying notes'));
  console.log('');
}
