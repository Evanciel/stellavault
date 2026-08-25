import chalk from 'chalk';
import { loadConfig, createSqliteVecStore, createLocalEmbedder, createSearchEngine, resolveSearchWeights,
         runMaintenanceIfOwned } from '@stellavault/core';
import type { CliCommand } from '../types.js';
import { refuseForeignDbEarly } from '../db-guard.js';

export async function searchCommand(query: string, options: { limit?: string }, cmd: CliCommand) {
  const globalOpts = cmd?.parent?.opts?.() ?? {};
  const jsonMode = globalOpts.json;
  const config = loadConfig();
  const limit = parseInt(options.limit ?? '5', 10);

  const store = createSqliteVecStore(config.dbPath);
  // 🔴 DB 를 <열기 전에> 각인을 묻는다. `initialize()` 는 여는 것만으로
  //    WAL 전환·CREATE TABLE·ALTER TABLE 을 남의 DB 에 실행한다.
  refuseForeignDbEarly(config.dbPath, config.vaultPath ?? '', 'search');
  await store.initialize();
  // 🔴 옛 DB 는 백필·고아 임베딩 정리가 돌아야 검색이 제 값을 낸다 (코덱스 14차 P2).
  //    고아 임베딩은 KNN 슬롯을 차지한 뒤 조인에서 사라져 <결과를 조용히 갉아먹는다>.
  // ⚠️ 각인이 <확정된> DB 에서만 돈다. 백필이 필요한 것은 대개 각인 이전의 옛 DB 라
  //    정확히 그 집합이 빠지지만, 각인 없는 DB 는 <우리 것인지 모르는> DB 라 쓰지 않는다.
  //    이관 경로는 `stellavault index <볼트>` 한 번이고 그때 함께 돈다.
  runMaintenanceIfOwned(store, config.vaultPath ?? '');

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
