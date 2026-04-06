// stellavault compile — raw → wiki 컴파일 CLI

import chalk from 'chalk';
import { loadConfig, compileWiki } from '@stellavault/core';
import { resolve, join } from 'node:path';

export async function compileCommand(options: { raw?: string; wiki?: string; force?: boolean }) {
  const config = loadConfig();
  const vaultPath = config.vaultPath;

  const rawPath = resolve(vaultPath, options.raw ?? 'raw');
  const wikiPath = resolve(vaultPath, options.wiki ?? '_wiki');

  console.error(chalk.dim(`Raw: ${rawPath}`));
  console.error(chalk.dim(`Wiki: ${wikiPath}`));
  console.error('');

  const result = compileWiki(rawPath, wikiPath, { force: options.force });

  if (result.rawDocCount === 0) {
    console.error(chalk.yellow(`No documents found in ${rawPath}`));
    console.error(chalk.dim('Create a raw/ folder in your vault and add .md/.txt files.'));
    return;
  }

  console.log(chalk.green(`Compiled ${result.rawDocCount} raw docs → ${result.wikiArticles.length} wiki articles`));
  console.log(chalk.dim(`Concepts: ${result.concepts.length}`));
  console.log(chalk.dim(`Index: ${result.indexFile}`));

  if (result.concepts.length > 0) {
    console.log('');
    console.log(chalk.cyan('Top concepts:'));
    for (const c of result.concepts.slice(0, 10)) {
      console.log(`  ${c}`);
    }
  }
}
