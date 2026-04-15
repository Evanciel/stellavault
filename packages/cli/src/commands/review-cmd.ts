// Design Ref: stellavault review — 일일 지식 리뷰 (FSRS 기반)
// Plan SC: "잊어가는 지식 리마인드 → 실제 액션"

import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { loadConfig, createKnowledgeHub, DecayEngine } from '@stellavault/core';

interface ReviewOpts {
  count?: string;
  json?: boolean;
  seed?: string;
  exclude?: string;
  minAge?: string;
}

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.+')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  return new RegExp('^' + esc + '$');
}

function seededRotate<T>(arr: T[], seed: string): T[] {
  if (!seed) return arr;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const offset = Math.abs(h) % Math.max(1, arr.length);
  return arr.slice(offset).concat(arr.slice(0, offset));
}

export async function reviewCommand(options: ReviewOpts) {
  const config = loadConfig();
  const hub = createKnowledgeHub(config);
  const count = parseInt(options.count ?? '5', 10);
  const minAgeDays = parseInt(options.minAge ?? '0', 10);
  const excludeRe = options.exclude ? globToRegex(options.exclude) : null;

  if (!options.json) console.error(chalk.dim('⏳ Initializing...'));
  await hub.store.initialize();

  const db = hub.store.getDb() as any;
  if (!db) {
    console.error(chalk.red('❌ Cannot access database'));
    process.exit(1);
  }

  const decayEngine = new DecayEngine(db);
  // 풀을 넉넉히 뽑아서 exclude/min-age 필터링 후 count만큼 자름
  let pool = await decayEngine.getDecaying(0.6, Math.max(count * 5, 50));

  if (excludeRe || minAgeDays > 0) {
    pool = pool.filter((d: any) => {
      const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(d.documentId) as any;
      const fp = doc?.file_path ?? '';
      if (excludeRe && excludeRe.test(fp)) return false;
      if (minAgeDays > 0) {
        const ageDays = (Date.now() - new Date(d.lastAccess).getTime()) / 86400000;
        if (ageDays < minAgeDays) return false;
      }
      return true;
    });
  }

  if (options.seed) pool = seededRotate(pool, options.seed);
  const decaying = pool.slice(0, count);

  if (options.json) {
    const out = decaying.map((d: any) => {
      const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(d.documentId) as any;
      const ageDays = Math.round((Date.now() - new Date(d.lastAccess).getTime()) / 86400000);
      return {
        documentId: d.documentId,
        title: d.title,
        filePath: doc?.file_path ?? null,
        retrievability: d.retrievability,
        lastAccess: d.lastAccess,
        ageDays,
        reviewScore: d.retrievability * 0.7 + Math.min(1, ageDays / 30) * 0.3,
      };
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (decaying.length === 0) {
    console.log(chalk.green('\n✨ All knowledge is healthy! No notes to review.'));
    return;
  }

  console.log(chalk.green(`\n🧠 Today's review (${decaying.length})`));
  console.log(chalk.dim('─'.repeat(50)));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  let reviewed = 0;

  for (let i = 0; i < decaying.length; i++) {
    const d = decaying[i];
    const elapsed = Math.round(
      (Date.now() - new Date(d.lastAccess).getTime()) / 86400000
    );
    const rBar = '█'.repeat(Math.round(d.retrievability * 10))
      + '░'.repeat(10 - Math.round(d.retrievability * 10));
    const color = d.retrievability < 0.3 ? chalk.red : chalk.yellow;

    console.log(`\n${chalk.bold(`[${i + 1}/${decaying.length}]`)} ${chalk.cyan(d.title)}`);
    console.log(`  ${color(rBar)} R=${d.retrievability.toFixed(2)} | ${elapsed} days ago`);

    const answer = await ask(chalk.dim('  → [y]open [n]skip [s]snooze [q]quit: '));

    if (answer.toLowerCase() === 'q') {
      console.log(chalk.dim('\nReview stopped.'));
      break;
    }

    if (answer.toLowerCase() === 's') {
      // Snooze: stability를 1일만 살짝 올려서 내일 다시 나오게
      await decayEngine.recordAccess({
        documentId: d.documentId,
        type: 'view',
        timestamp: new Date(Date.now() - 23 * 3600000).toISOString(), // 23시간 전으로 기록
      });
      console.log(chalk.dim('  ⏰ Reminder set for tomorrow'));
      continue;
    }

    if (answer.toLowerCase() === 'y') {
      // Obsidian에서 열기
      const relFile = (d as any).filePath
        ? (d as any).filePath.replace(/\\/g, '/').replace(/\.md$/, '')
        : d.title;

      let vault = 'Evan';
      try {
        const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(d.documentId) as any;
        if (doc?.file_path) {
          const fp = doc.file_path.replace(/\\/g, '/').replace(/\.md$/, '');
          // vault 이름 = config.vaultPath의 마지막 디렉토리명
          vault = config.vaultPath?.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? 'Evan';

          const uri = `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(fp)}`;
          const open = await import('open');
          await open.default(uri);
        }
      } catch { /* fallback: no open */ }

      // 접근 기록 → stability 업데이트
      await decayEngine.recordAccess({
        documentId: d.documentId,
        type: 'view',
        timestamp: new Date().toISOString(),
      });
      reviewed++;
      console.log(chalk.green('  ✅ Opened + memory strength updated'));
    } else {
      console.log(chalk.dim('  ⏭️ Skipped'));
    }
  }

  rl.close();

  console.log(chalk.dim('\n─'.repeat(50)));
  console.log(chalk.green(`Review complete! ${reviewed}/${decaying.length} reviewed`));

  // streak 계산 (access_log에서 연속 일수)
  try {
    const days = db.prepare(`
      SELECT DISTINCT date(accessed_at) as d FROM access_log
      WHERE access_type = 'view'
      ORDER BY d DESC LIMIT 30
    `).all() as any[];

    let streak = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < days.length; i++) {
      const expected = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      if (days[i]?.d === expected) streak++;
      else break;
    }
    if (streak > 1) {
      console.log(chalk.yellow(`🔥 ${streak}-day review streak!`));
    }
  } catch { /* streak 실패해도 무시 */ }
}
