// stellavault brief — 아침 브리핑 (decay + gaps + streak 통합)

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, DecayEngine, detectKnowledgeGaps } from '@stellavault/core';

export async function briefCommand() {
  const config = loadConfig();
  const hub = createKnowledgeHub(config);

  await hub.store.initialize();
  await hub.embedder.initialize();

  const db = hub.store.getDb() as any;
  if (!db) { console.error(chalk.red('❌ Cannot access database')); process.exit(1); }

  const decayEngine = new DecayEngine(db);
  const stats = await hub.store.getStats();

  console.log(chalk.green('\n☀️ Good morning! Today\'s knowledge briefing'));
  console.log(chalk.dim('─'.repeat(50)));

  // 1. 전체 상태
  console.log(`\n📚 ${chalk.bold(String(stats.documentCount))} notes | ${stats.chunkCount} chunks`);

  // 2. 감쇠 요약
  const report = await decayEngine.computeAll();
  const avgRColor = report.averageR >= 0.7 ? chalk.green : report.averageR >= 0.5 ? chalk.yellow : chalk.red;
  console.log(`🧠 Overall health: ${avgRColor('R=' + report.averageR)} | Decaying ${chalk.yellow(String(report.decayingCount))} | Critical ${chalk.red(String(report.criticalCount))}`);

  // 3. 리뷰 대상 Top 5
  if (report.topDecaying.length > 0) {
    console.log(chalk.yellow('\n📋 Review recommendations:'));
    for (const d of report.topDecaying.slice(0, 5)) {
      const bar = '█'.repeat(Math.round(d.retrievability * 10)) + '░'.repeat(10 - Math.round(d.retrievability * 10));
      console.log(`  ${chalk.dim(bar)} R=${d.retrievability.toFixed(2)} ${d.title}`);
    }
    console.log(chalk.dim('  → Run stellavault review to start'));
  }

  // 4. 갭 요약
  try {
    const gapReport = await detectKnowledgeGaps(hub.store);
    const highGaps = gapReport.gaps.filter(g => g.severity === 'high');
    if (highGaps.length > 0) {
      console.log(chalk.yellow(`\n🕳️ ${highGaps.length} knowledge gaps:`));
      for (const g of highGaps.slice(0, 3)) {
        console.log(`  🔴 ${g.clusterA.replace(/\s*\(\d+\)$/, '')} ↔ ${g.clusterB.replace(/\s*\(\d+\)$/, '')}`);
      }
    }
  } catch { /* gaps 실패해도 무시 */ }

  // 5. Streak
  try {
    const days = db.prepare(`
      SELECT DISTINCT date(accessed_at) as d FROM access_log
      WHERE access_type = 'view' ORDER BY d DESC LIMIT 30
    `).all() as any[];

    let streak = 0;
    for (let i = 0; i < days.length; i++) {
      const expected = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      if (days[i]?.d === expected) streak++;
      else break;
    }
    if (streak > 0) console.log(chalk.yellow(`\n🔥 ${streak}-day review streak!`));
  } catch {}

  // 6. 최근 활동
  try {
    const recent = db.prepare(`
      SELECT document_id, COUNT(*) as cnt FROM access_log
      WHERE accessed_at > datetime('now', '-7 days')
      GROUP BY document_id ORDER BY cnt DESC LIMIT 3
    `).all() as any[];

    if (recent.length > 0) {
      console.log(chalk.dim('\n📊 Most viewed notes this week:'));
      for (const r of recent) {
        const doc = db.prepare('SELECT title FROM documents WHERE id = ?').get(r.document_id) as any;
        console.log(`  ${r.cnt} views — ${doc?.title ?? r.document_id}`);
      }
    }
  } catch {}

  console.log('\n' + chalk.dim('─'.repeat(50)));
  console.log(chalk.dim('💡 stellavault review | stellavault gaps | stellavault graph'));
}
