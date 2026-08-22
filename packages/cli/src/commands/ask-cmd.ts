// stellavault ask — Q&A + auto-filing CLI command

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, askVault, runMaintenanceIfOwned } from '@stellavault/core';
import { refuseForeignDbEarly } from '../db-guard.js';

export async function askCommand(question: string, options: { save?: boolean; quotes?: boolean }) {
  if (!question || question.trim().length < 2) {
    console.error(chalk.yellow('Usage: stellavault ask "your question here" [--save]'));
    console.error(chalk.dim('\nSearch Mode: finds relevant notes from your vault.'));
    console.error(chalk.dim('For AI-powered answers, use MCP: claude mcp add stellavault -- stellavault serve'));
    process.exit(1);
  }

  const config = loadConfig();
  const hub = createKnowledgeHub(config);

  console.error(chalk.dim('Searching your knowledge (local search mode)...'));
  // 🔴 DB 를 <열기 전에> 각인을 묻는다. `initialize()` 는 여는 것만으로
  //    WAL 전환·CREATE TABLE·ALTER TABLE 을 남의 DB 에 실행한다.
  refuseForeignDbEarly(config.dbPath, config.vaultPath ?? '', 'ask');
  await hub.store.initialize();
  // 🔴 옛 DB 는 백필·고아 임베딩 정리가 돌아야 검색이 제 값을 낸다 (코덱스 14차 P2).
  //    고아 임베딩은 KNN 슬롯을 차지한 뒤 조인에서 사라져 <결과를 조용히 갉아먹는다>.
  // ⚠️ 각인이 <확정된> DB 에서만 돈다. 백필이 필요한 것은 대개 각인 이전의 옛 DB 라
  //    정확히 그 집합이 빠지지만, 각인 없는 DB 는 <우리 것인지 모르는> DB 라 쓰지 않는다.
  //    이관 경로는 `stellavault index <볼트>` 한 번이고 그때 함께 돈다.
  runMaintenanceIfOwned(hub.store, config.vaultPath ?? '');
  await hub.embedder.initialize();

  const result = await askVault(hub.searchEngine, question, {
    limit: 10,
    save: options.save ?? false,
    vaultPath: config.vaultPath,
    mode: options.quotes ? 'quotes' : 'default',
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
