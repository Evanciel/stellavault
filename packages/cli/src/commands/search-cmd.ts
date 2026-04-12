import chalk from 'chalk';
import { loadConfig, createSqliteVecStore, createLocalEmbedder, createSearchEngine } from '@stellavault/core';

export async function searchCommand(query: string, options: { limit?: string }, cmd: any) {
  const globalOpts = cmd?.parent?.opts?.() ?? {};
  const jsonMode = globalOpts.json;
  const config = loadConfig();
  const limit = parseInt(options.limit ?? '5', 10);

  const store = createSqliteVecStore(config.dbPath);
  await store.initialize();

  const embedder = createLocalEmbedder(config.embedding.localModel);
  await embedder.initialize();

  const engine = createSearchEngine({ store, embedder, rrfK: config.search.rrfK });
  const results = await engine.search({ query, limit });

  await store.close();

  if (jsonMode) {
    console.log(JSON.stringify({
      query, count: results.length,
      results: results.map(r => ({
        title: r.document.title, path: r.document.filePath,
        score: r.score, heading: r.chunk.heading,
        snippet: r.chunk.content.slice(0, 200),
      })),
    }, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(chalk.yellow('No search results found.'));
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
