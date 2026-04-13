import chalk from 'chalk';
import { loadConfig, createSqliteVecStore } from '@stellavault/core';
import type { CliCommand } from '../types.js';

export async function statusCommand(_opts: Record<string, never>, cmd: CliCommand) {
  const globalOpts = cmd?.parent?.opts?.() ?? {};
  const jsonMode = globalOpts.json;
  const config = loadConfig();

  const store = createSqliteVecStore(config.dbPath);
  await store.initialize();
  const stats = await store.getStats();
  const topics = await store.getTopics();
  await store.close();

  if (jsonMode) {
    console.log(JSON.stringify({ ...stats, vaultPath: config.vaultPath, dbPath: config.dbPath, topics: topics.slice(0, 20) }, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold('📊 Stellavault Status'));
  console.log('─'.repeat(40));
  console.log(`  📄 Documents: ${stats.documentCount}`);
  console.log(`  🧩 Chunks:    ${stats.chunkCount}`);
  console.log(`  🕐 Last indexed: ${stats.lastIndexed ?? 'never'}`);
  console.log(`  💾 DB: ${config.dbPath}`);
  console.log(`  📁 Vault: ${config.vaultPath || '(not set)'}`);

  if (topics.length > 0) {
    console.log('');
    console.log(chalk.bold('🏷️ Top topics:'));
    topics.slice(0, 10).forEach((t: { topic: string; count: number }) => {
      console.log(`  #${t.topic} (${t.count})`);
    });
  }
  console.log('');
}
