// stellavault digest — 주간 지식 활동 리포트

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, DecayEngine } from '@stellavault/core';

interface AccessStat { access_type: string; cnt: number }
interface TopDoc { document_id: string; title: string; cnt: number }
interface DailyActivity { day: string; cnt: number }
interface TypeStat { type: string; cnt: number }

export async function digestCommand(options: { days?: string; visual?: boolean }) {
  const config = loadConfig();
  const hub = createKnowledgeHub(config);
  const days = parseInt(options.days ?? '7', 10);

  await hub.store.initialize();
  const db = hub.store.getDb() as any;
  if (!db) { console.error(chalk.red('❌ Cannot access database')); process.exit(1); }

  console.log(chalk.green(`\n📊 Knowledge activity report (last ${days} days)`));
  console.log(chalk.dim('─'.repeat(50)));

  // 1. 접근 통계
  const accessStats = db.prepare(`
    SELECT access_type, COUNT(*) as cnt
    FROM access_log WHERE accessed_at > datetime('now', '-${days} days')
    GROUP BY access_type
  `).all() as AccessStat[];

  const totalAccess = accessStats.reduce((s, r) => s + r.cnt, 0);
  console.log(`\n🔍 Total access: ${chalk.bold(String(totalAccess))} times`);
  for (const r of accessStats) {
    const icon = r.access_type === 'view' ? '👁️' : r.access_type === 'search' ? '🔍' : '🤖';
    console.log(`  ${icon} ${r.access_type}: ${r.cnt} times`);
  }

  // 2. 가장 많이 본 노트
  const topDocs = db.prepare(`
    SELECT al.document_id, d.title, COUNT(*) as cnt
    FROM access_log al
    JOIN documents d ON d.id = al.document_id
    WHERE al.accessed_at > datetime('now', '-${days} days')
    GROUP BY al.document_id
    ORDER BY cnt DESC LIMIT 10
  `).all() as TopDoc[];

  if (topDocs.length > 0) {
    console.log(chalk.dim(`\n📄 Most accessed notes:`));
    for (const d of topDocs) {
      const bar = '█'.repeat(Math.min(d.cnt, 20));
      console.log(`  ${chalk.cyan(bar)} ${d.cnt} views ${d.title}`);
    }
  }

  // 3. 일별 활동량
  const dailyActivity = db.prepare(`
    SELECT date(accessed_at) as day, COUNT(*) as cnt
    FROM access_log WHERE accessed_at > datetime('now', '-${days} days')
    GROUP BY day ORDER BY day
  `).all() as DailyActivity[];

  if (dailyActivity.length > 0) {
    console.log(chalk.dim('\n📅 Daily activity:'));
    const maxCnt = Math.max(...dailyActivity.map(d => d.cnt));
    for (const d of dailyActivity) {
      const barLen = Math.round((d.cnt / maxCnt) * 20);
      const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
      console.log(`  ${d.day.slice(5)} ${chalk.green(bar)} ${d.cnt}`);
    }
  }

  // 4. type별 분포
  const typeStats = db.prepare(`
    SELECT d.type, COUNT(DISTINCT al.document_id) as cnt
    FROM access_log al
    JOIN documents d ON d.id = al.document_id
    WHERE al.accessed_at > datetime('now', '-${days} days')
    GROUP BY d.type ORDER BY cnt DESC
  `).all() as TypeStat[];

  if (typeStats.length > 0) {
    console.log(chalk.dim('\n📊 Note types accessed:'));
    for (const t of typeStats) {
      console.log(`  ${t.type}: ${t.cnt}`);
    }
  }

  // 5. 감쇠 변화
  const decayEngine = new DecayEngine(db);
  const report = await decayEngine.computeAll();
  console.log(`\n🧠 Health: R=${report.averageR} | Decaying ${report.decayingCount} | Critical ${report.criticalCount}`);

  console.log(chalk.dim('\n═'.repeat(50)));

  // --visual: Mermaid 다이어그램 + 요약을 .md로 저장
  if (options.visual) {
    const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const outputDir = resolve(config.vaultPath, '_stellavault/digests');
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const filename = `digest-${date}.md`;
    const outputPath = join(outputDir, filename);

    // Mermaid 파이 차트
    const pieData = (typeStats.length > 0 ? typeStats : [{ type: 'note', cnt: 1 }])
      .map(t => `    "${t.type}" : ${t.cnt}`)
      .join('\n');

    // Mermaid 타임라인
    const timelineData = dailyActivity
      .map(d => `    ${d.day.slice(5)} : ${d.cnt}`)
      .join('\n');

    const md = [
      '---',
      `title: "Weekly Digest — ${date}"`,
      'type: digest',
      `date: ${new Date().toISOString()}`,
      'source: stellavault-digest',
      '---',
      '',
      `# Weekly Knowledge Digest — ${date}`,
      '',
      `## Summary`,
      `- Total access: **${totalAccess}** in ${days} days`,
      `- Average R: **${report.averageR.toFixed(2)}**`,
      `- Decaying: ${report.decayingCount} | Critical: ${report.criticalCount}`,
      '',
      '## Activity by Type',
      '```mermaid',
      'pie title Note Types Accessed',
      pieData,
      '```',
      '',
      '## Daily Activity',
      '```mermaid',
      'xychart-beta',
      `    title "Daily Activity (${days} days)"`,
      '    x-axis [' + dailyActivity.map(d => `"${d.day.slice(5)}"`).join(', ') + ']',
      '    y-axis "Access Count"',
      '    bar [' + dailyActivity.map(d => d.cnt).join(', ') + ']',
      '```',
      '',
      topDocs.length > 0 ? '## Most Accessed Notes\n' + topDocs.map(d => `1. **${d.title}** — ${d.cnt} times`).join('\n') : '',
      '',
      '---',
      `*Generated by \`stellavault digest --visual\` on ${new Date().toISOString()}*`,
    ].filter(Boolean).join('\n');

    writeFileSync(outputPath, md, 'utf-8');
    console.log(chalk.green(`\nVisual digest saved: ${filename}`));
    console.log(chalk.dim(`Open in Obsidian to see Mermaid charts.`));
  }
}
