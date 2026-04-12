// Design Ref: stellavault gaps — 지식 갭 탐지 CLI

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, detectKnowledgeGaps } from '@stellavault/core';

export async function gapsCommand() {
  const config = loadConfig();
  const hub = createKnowledgeHub(config);

  console.error(chalk.dim('⏳ Analyzing knowledge gaps...'));
  await hub.store.initialize();
  await hub.embedder.initialize();

  const report = await detectKnowledgeGaps(hub.store);

  console.log(chalk.green('\n🕳️ Knowledge Gap Report'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`  Clusters: ${report.totalClusters}`);
  console.log(`  Gaps: ${chalk.yellow(String(report.totalGaps))} (High+Medium)`);
  console.log(`  Isolated nodes: ${report.isolatedNodes.length}`);
  console.log(chalk.dim('─'.repeat(50)));

  if (report.gaps.length > 0) {
    console.log(chalk.yellow('\n📊 Inter-cluster gaps:'));
    for (const gap of report.gaps) {
      const icon = gap.severity === 'high' ? '🔴' : gap.severity === 'medium' ? '🟡' : '🟢';
      console.log(`  ${icon} ${gap.clusterA} ↔ ${gap.clusterB}`);
      console.log(`     Bridges: ${gap.bridgeCount} | Suggestion: ${chalk.cyan(gap.suggestedTopic)}`);
    }
  }

  if (report.isolatedNodes.length > 0) {
    console.log(chalk.dim('\n🏝️ Isolated notes (≤1 connections):'));
    for (const n of report.isolatedNodes.slice(0, 10)) {
      console.log(`  • ${n.title} (${n.connections} connections)`);
    }
  }

  console.log(chalk.dim('\n💡 Filling knowledge gaps strengthens your graph'));
}
