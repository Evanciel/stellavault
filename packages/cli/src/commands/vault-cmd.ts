// sv vault add/list/remove/search-all — Cross-Vault (P3)

import chalk from 'chalk';
import { addVault, removeVault, listVaults, searchAllVaults, loadConfig, createSqliteVecStore, createLocalEmbedder } from '@stellavault/core';

export async function vaultAddCommand(id: string, vaultPath: string, options: { name?: string; shared?: boolean }) {
  const config = loadConfig();
  const dbPath = vaultPath.replace(/\/$/, '') + '/.stellavault/index.db';
  try {
    const entry = addVault(id, options.name ?? id, vaultPath, dbPath, !!options.shared);
    console.log(chalk.green(`\n  ✅ Vault "${entry.name}" added (${entry.id})`));
    console.log(chalk.dim(`    Path: ${entry.path}\n    DB: ${entry.dbPath}\n`));
  } catch (err) {
    console.log(chalk.red(`\n  ❌ ${err instanceof Error ? err.message : err}\n`));
  }
}

export async function vaultListCommand() {
  const vaults = listVaults();
  if (vaults.length === 0) {
    console.log(chalk.yellow('\n  No vaults registered. Use: sv vault add <id> <path>\n'));
    return;
  }
  console.log(chalk.bold('\n  Registered Vaults'));
  for (const v of vaults) {
    console.log(`  ${chalk.cyan(v.id)} ${v.name} ${chalk.dim(`(${v.path})`)}`);
  }
  console.log('');
}

export async function vaultRemoveCommand(id: string) {
  if (removeVault(id)) {
    console.log(chalk.green(`\n  ✅ Vault "${id}" removed\n`));
  } else {
    console.log(chalk.red(`\n  ❌ Vault "${id}" not found\n`));
  }
}

export async function vaultSearchAllCommand(query: string, options: { limit?: string }) {
  const config = loadConfig();
  const embedder = createLocalEmbedder(config.embedding.localModel);
  await embedder.initialize();

  console.log(chalk.dim(`\n  Searching all vaults for "${query}"...`));

  const results = await searchAllVaults(
    query, embedder,
    (dbPath) => createSqliteVecStore(dbPath),
    { limit: parseInt(options.limit ?? '10', 10) },
  );

  if (results.length === 0) {
    console.log(chalk.yellow('  No results across vaults.\n'));
    return;
  }

  for (const r of results) {
    const pct = Math.round(r.score * 100);
    const color = pct >= 70 ? chalk.green : pct >= 40 ? chalk.yellow : chalk.dim;
    console.log(`  ${color(`${pct}%`)} ${chalk.bold(r.title)} ${chalk.dim(`[${r.vaultName}]`)}`);
    console.log(`     ${chalk.dim(r.snippet)}...`);
  }
  console.log('');
}
