import chalk from 'chalk';
import { loadConfig, createSqliteVecStore, createLocalEmbedder, createSearchEngine, resolveSearchWeights } from '@stellavault/core';
import type { CliCommand } from '../types.js';

export async function searchCommand(query: string, options: { limit?: string }, cmd: CliCommand) {
  const globalOpts = cmd?.parent?.opts?.() ?? {};
  const jsonMode = globalOpts.json;
  const config = loadConfig();
  const limit = parseInt(options.limit ?? '5', 10);

  const store = createSqliteVecStore(config.dbPath);
  await store.initialize();

  const embedder = createLocalEmbedder(config.embedding.localModel);
  await embedder.initialize();

  // CLI is a fresh process → no decay engine → recency disabled; config/env
  // weights still apply so CLI and MCP search rank consistently. (B3 §3.4)
  const sw = resolveSearchWeights(config);
  const engine = createSearchEngine({
    store, embedder, rrfK: config.search.rrfK,
    weights: { semantic: sw.semantic, bm25: sw.bm25, entity: sw.entity, recency: sw.recency },
    entityAliases: config.search.entityAliases, // B2.2
  });
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
