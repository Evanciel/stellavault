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
  console.log(`  클러스터: ${report.totalClusters}개`);
  console.log(`  갭: ${chalk.yellow(String(report.totalGaps))}개 (High+Medium)`);
  console.log(`  고립 노드: ${report.isolatedNodes.length}개`);
  console.log(chalk.dim('─'.repeat(50)));

  if (report.gaps.length > 0) {
    console.log(chalk.yellow('\n📊 클러스터 간 갭:'));
    for (const gap of report.gaps) {
      const icon = gap.severity === 'high' ? '🔴' : gap.severity === 'medium' ? '🟡' : '🟢';
      console.log(`  ${icon} ${gap.clusterA} ↔ ${gap.clusterB}`);
      console.log(`     연결: ${gap.bridgeCount}개 | 제안: ${chalk.cyan(gap.suggestedTopic)}`);
    }
  }

  if (report.isolatedNodes.length > 0) {
    console.log(chalk.dim('\n🏝️ 고립된 노트 (연결 ≤1):'));
    for (const n of report.isolatedNodes.slice(0, 10)) {
      console.log(`  • ${n.title} (${n.connections}개 연결)`);
    }
  }

  console.log(chalk.dim('\n💡 갭 영역의 지식을 보강하면 지식 그래프가 더 촘촘해집니다'));
}
