import chalk from 'chalk';
import { loadConfig, createSqliteVecStore, createLocalEmbedder, createSearchEngine } from '@stellavault/core';

export async function searchCommand(query: string, options: { limit?: string }) {
  const config = loadConfig();
  const limit = parseInt(options.limit ?? '5', 10);

  const store = createSqliteVecStore(config.dbPath);
  await store.initialize();

  const embedder = createLocalEmbedder(config.embedding.localModel);
  await embedder.initialize();

  const engine = createSearchEngine({ store, embedder, rrfK: config.search.rrfK });
  const results = await engine.search({ query, limit });

  await store.close();

  if (results.length === 0) {
    console.log(chalk.yellow('검색 결과가 없습니다.'));
    return;
  }

  console.log('');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`  ${chalk.bold(`${i + 1}.`)} ${chalk.cyan(`[${r.score.toFixed(3)}]`)} ${chalk.white(r.document.filePath)} ${chalk.dim(`§${r.chunk.heading}`)}`);
    console.log(`     ${chalk.dim(r.chunk.content.slice(0, 120).replace(/\n/g, ' '))}...`);
  }
  console.log('');
}
