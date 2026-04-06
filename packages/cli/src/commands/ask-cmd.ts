// stellavault ask — Q&A + auto-filing CLI command

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, askVault } from '@stellavault/core';

export async function askCommand(question: string, options: { save?: boolean }) {
  if (!question || question.trim().length < 2) {
    console.error(chalk.yellow('Usage: stellavault ask "your question here" [--save]'));
    console.error(chalk.dim('\nSearch Mode: finds relevant notes from your vault.'));
    console.error(chalk.dim('For AI-powered answers, use MCP: claude mcp add stellavault -- stellavault serve'));
    process.exit(1);
  }

  const config = loadConfig();
  const hub = createKnowledgeHub(config);

  console.error(chalk.dim('Searching your knowledge (local search mode)...'));
  await hub.store.initialize();
  await hub.embedder.initialize();

  const result = await askVault(hub.searchEngine, question, {
    limit: 10,
    save: options.save ?? false,
    vaultPath: config.vaultPath,
  });

  // 출력
  console.log('');
  console.log(result.answer);

  if (result.savedTo) {
    console.log('');
    console.log(chalk.green(`Saved to: ${result.savedTo}`));
  }

  if (result.sources.length > 0 && !options.save) {
    console.log('');
    console.log(chalk.dim('Tip: Add --save to file this answer into your vault.'));
    console.log(chalk.dim('For AI-generated answers: use Claude Code with MCP integration.'));
  }

  await hub.store.close?.();
}
