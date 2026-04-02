// stellavault digest — 주간 지식 활동 리포트

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, DecayEngine } from '@stellavault/core';

export async function digestCommand(options: { days?: string }) {
  const config = loadConfig();
  const hub = createKnowledgeHub(config);
  const days = parseInt(options.days ?? '7', 10);

  await hub.store.initialize();
  const db = hub.store.getDb() as any;
  if (!db) { console.error(chalk.red('❌ DB 접근 불가')); process.exit(1); }

  console.log(chalk.green(`\n📊 지식 활동 리포트 (최근 ${days}일)`));
  console.log(chalk.dim('─'.repeat(50)));

  // 1. 접근 통계
  const accessStats = db.prepare(`
    SELECT access_type, COUNT(*) as cnt
    FROM access_log WHERE accessed_at > datetime('now', '-${days} days')
    GROUP BY access_type
  `).all() as any[];

  const totalAccess = accessStats.reduce((s: number, r: any) => s + r.cnt, 0);
  console.log(`\n🔍 총 접근: ${chalk.bold(String(totalAccess))}회`);
  for (const r of accessStats) {
    const icon = r.access_type === 'view' ? '👁️' : r.access_type === 'search' ? '🔍' : '🤖';
    console.log(`  ${icon} ${r.access_type}: ${r.cnt}회`);
  }

  // 2. 가장 많이 본 노트
  const topDocs = db.prepare(`
    SELECT al.document_id, d.title, COUNT(*) as cnt
    FROM access_log al
    JOIN documents d ON d.id = al.document_id
    WHERE al.accessed_at > datetime('now', '-${days} days')
    GROUP BY al.document_id
    ORDER BY cnt DESC LIMIT 10
  `).all() as any[];

  if (topDocs.length > 0) {
    console.log(chalk.dim(`\n📄 가장 많이 접근한 노트:`));
    for (const d of topDocs) {
      const bar = '█'.repeat(Math.min(d.cnt, 20));
      console.log(`  ${chalk.cyan(bar)} ${d.cnt}회 ${d.title}`);
    }
  }

  // 3. 일별 활동량
  const dailyActivity = db.prepare(`
    SELECT date(accessed_at) as day, COUNT(*) as cnt
    FROM access_log WHERE accessed_at > datetime('now', '-${days} days')
    GROUP BY day ORDER BY day
  `).all() as any[];

  if (dailyActivity.length > 0) {
    console.log(chalk.dim('\n📅 일별 활동:'));
    const maxCnt = Math.max(...dailyActivity.map((d: any) => d.cnt));
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
  `).all() as any[];

  if (typeStats.length > 0) {
    console.log(chalk.dim('\n📊 접근한 노트 유형:'));
    for (const t of typeStats) {
      console.log(`  ${t.type}: ${t.cnt}개`);
    }
  }

  // 5. 감쇠 변화
  const decayEngine = new DecayEngine(db);
  const report = await decayEngine.computeAll();
  console.log(`\n🧠 건강도: R=${report.averageR} | 감쇠 ${report.decayingCount}개 | 위험 ${report.criticalCount}개`);

  console.log(chalk.dim('\n═'.repeat(50)));
}
