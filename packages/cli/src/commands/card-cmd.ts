// stellavault card — SVG 프로필 카드 생성

import chalk from 'chalk';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function cardCommand(options: { output?: string }) {
  const output = options.output ?? 'knowledge-card.svg';
  const outPath = resolve(process.cwd(), output);

  console.error(chalk.dim('⏳ Generating profile card...'));

  try {
    // API 서버에서 SVG 가져오기 (서버가 실행 중이어야 함)
    const res = await fetch('http://127.0.0.1:3333/api/profile-card');
    if (!res.ok) throw new Error(`API error: ${res.status}. Is 'stellavault graph' running?`);

    const svg = await res.text();
    writeFileSync(outPath, svg, 'utf-8');

    console.error(chalk.green(`✅ Profile card saved: ${outPath}`));
    console.error(chalk.dim('   Embed in GitHub README:'));
    console.error(chalk.dim(`   ![Knowledge Card](${output})`));
  } catch (err) {
    console.error(chalk.red(`❌ Failed: ${err}`));
    console.error(chalk.dim('   Make sure API server is running: stellavault graph'));
    process.exit(1);
  }
}
