import chalk from 'chalk';
import { loadConfig, createSqliteVecStore } from '@stellavault/core';

export async function statusCommand() {
  const config = loadConfig();

  const store = createSqliteVecStore(config.dbPath);
  await store.initialize();
  const stats = await store.getStats();
  const topics = await store.getTopics();
  await store.close();

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
    topics.slice(0, 10).forEach(t => {
      console.log(`  #${t.topic} (${t.count})`);
    });
  }
  console.log('');
}
