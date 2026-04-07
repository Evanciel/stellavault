// stellavault draft — Express: 지식에서 초안 생성
// 카파시 자가 컴파일 → 외부 표현의 출구

import chalk from 'chalk';
import { loadConfig } from '@stellavault/core';
import { generateDraft } from '@stellavault/core/intelligence/draft-generator';

export async function draftCommand(topic: string | undefined, options: { format?: string }) {
  const config = loadConfig();

  if (!config.vaultPath) {
    console.error(chalk.red('No vault configured. Run `stellavault init` first.'));
    process.exit(1);
  }

  const format = (options.format ?? 'blog') as 'blog' | 'report' | 'outline';

  try {
    const result = generateDraft(config.vaultPath, { topic, format }, config.folders);

    console.log(chalk.green(`Draft generated: ${result.title}`));
    console.log(chalk.dim(`  Format: ${format}`));
    console.log(chalk.dim(`  Saved: ${result.filePath}`));
    console.log(chalk.dim(`  Words: ${result.wordCount}`));
    console.log(chalk.dim(`  Sources: ${result.sourceCount} documents`));
    if (result.concepts.length > 0) {
      console.log(chalk.dim(`  Concepts: ${result.concepts.join(', ')}`));
    }
    console.log('');
    console.log(chalk.dim('Edit the draft in Obsidian, then share!'));
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : 'Draft generation failed'));
    process.exit(1);
  }
}
