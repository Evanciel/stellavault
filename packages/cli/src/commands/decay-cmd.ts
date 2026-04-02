// Design Ref: §4.2 — CLI stellavault decay 명령
// Plan SC: SC-03

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, DecayEngine } from '@stellavault/core';

export async function decayCommand(_opts: any, cmd: any) {
  const globalOpts = cmd?.parent?.opts?.() ?? {};
  const jsonMode = globalOpts.json;
  const config = loadConfig();
  const hub = createKnowledgeHub(config);

  console.error(chalk.dim('⏳ Initializing...'));
  await hub.store.initialize();

  const db = hub.store.getDb() as any;
  if (!db) {
    console.error(chalk.red('❌ Cannot access database'));
    process.exit(1);
  }

  const decayEngine = new DecayEngine(db);
  const report = await decayEngine.computeAll();

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    await hub.store.close();
    return;
  }

  console.log(chalk.green('\n🧠 Knowledge Decay Report'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`  📄 Total documents:  ${report.totalDocuments}`);
  console.log(`  ⚠️  Decaying (R<0.5): ${chalk.yellow(String(report.decayingCount))}`);
  console.log(`  🔴 Critical (R<0.3): ${chalk.red(String(report.criticalCount))}`);
  console.log(`  📊 Average R:        ${report.averageR}`);
  console.log(chalk.dim('─'.repeat(50)));

  if (report.topDecaying.length > 0) {
    console.log(chalk.yellow('\n📋 Top Decaying Notes (리마인드 필요):'));
    for (const d of report.topDecaying.slice(0, 20)) {
      const rBar = '█'.repeat(Math.round(d.retrievability * 10)) + '░'.repeat(10 - Math.round(d.retrievability * 10));
      const color = d.retrievability < 0.3 ? chalk.red : chalk.yellow;
      console.log(`  ${color(rBar)} R=${d.retrievability.toFixed(2)} | ${d.daysSinceAccess}d ago | ${d.title}`);
    }
  }

  if (report.clusterHealth.length > 0) {
    console.log(chalk.dim('\n📊 Cluster Health:'));
    for (const c of report.clusterHealth.slice(0, 10)) {
      const color = c.avgR < 0.3 ? chalk.red : c.avgR < 0.5 ? chalk.yellow : chalk.green;
      console.log(`  ${color(`R=${c.avgR.toFixed(2)}`)} | ${c.count} docs | ${c.label}`);
    }
  }

  console.log(chalk.dim('\n💡 Tip: stellavault search <topic> to refresh decaying knowledge'));
}
