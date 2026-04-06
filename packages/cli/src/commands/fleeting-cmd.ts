// stellavault fleeting — 찰나 메모 즉시 캡처
// "떠오른 생각을 raw/ 폴더에 즉시 저장"

import chalk from 'chalk';
import { loadConfig } from '@stellavault/core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export async function fleetingCommand(text: string, options: { tags?: string }) {
  if (!text || text.trim().length < 2) {
    console.error(chalk.yellow('Usage: stellavault fleeting "your idea here" [--tags tag1,tag2]'));
    process.exit(1);
  }

  const config = loadConfig();
  const rawDir = resolve(config.vaultPath, 'raw');
  if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = text.slice(0, 40).replace(/[^a-zA-Z0-9가-힣\s]/g, '').replace(/\s+/g, '-').toLowerCase();
  const filename = `${timestamp}-${slug}.md`;
  const filePath = join(rawDir, filename);

  // path traversal 방지
  if (!resolve(filePath).startsWith(resolve(rawDir))) {
    console.error(chalk.red('Invalid file path'));
    process.exit(1);
  }

  const tags = options.tags ? options.tags.split(',').map(t => t.trim()) : [];
  const content = [
    '---',
    `title: "${text.slice(0, 80)}"`,
    'type: fleeting',
    `created: ${now.toISOString()}`,
    `tags: [${tags.map(t => `"${t}"`).join(', ')}]`,
    '---',
    '',
    text,
    '',
    '---',
    `*Captured via \`stellavault fleeting\` at ${now.toLocaleString('ko-KR')}*`,
  ].join('\n');

  writeFileSync(filePath, content, 'utf-8');

  console.log(chalk.green(`Captured: ${filename}`));
  console.log(chalk.dim(`Location: raw/${filename}`));
  console.log(chalk.dim('Run `stellavault compile` to process into wiki.'));
}
