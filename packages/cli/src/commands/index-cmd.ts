import ora from 'ora';
import chalk from 'chalk';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { loadConfig, createSqliteVecStore, createLocalEmbedder, indexVault, addVault, listVaults } from '@stellavault/core';
import type { SkipReason } from '@stellavault/core';

interface IndexOpts {
  noSpinner?: boolean;
  verbose?: boolean;
  logSkipped?: string;
  profileMemory?: boolean;
}

function getVaultDbPath(vaultPath: string): string {
  const hash = createHash('sha256').update(vaultPath).digest('hex').slice(0, 8);
  const dir = join(homedir(), '.stellavault', 'vaults');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${hash}.db`);
}

export async function indexCommand(vaultPath?: string, opts: IndexOpts = {}) {
  if (opts.profileMemory) process.env.STELLAVAULT_PROFILE_MEMORY = '1';

  const config = loadConfig();
  const vault = vaultPath ?? config.vaultPath;
  if (!vault) {
    console.error(chalk.red('Error: vault path required. Use stellavault index <path> or set vaultPath in .stellavault.json'));
    process.exit(1);
  }

  const dbPath = vaultPath ? getVaultDbPath(vault) : config.dbPath;

  const existingVaults = listVaults();
  const vaultName = vault.split(/[/\\]/).filter(Boolean).pop() ?? 'vault';
  if (!existingVaults.some(v => v.path === vault)) {
    try {
      addVault(vaultName.toLowerCase(), vaultName, vault, dbPath);
      console.log(chalk.dim(`  Auto-registered vault: ${vaultName} (${dbPath})`));
    } catch { /* 이미 등록됨 */ }
  }

  // TTY 감지 + 플래그 기반 스피너 활성화 제어
  const spinnerEnabled = !opts.noSpinner && !opts.verbose && process.stderr.isTTY;
  const spinner = ora({ text: 'Initializing...', isEnabled: spinnerEnabled }).start();
  const store = createSqliteVecStore(dbPath);

  // 크래시 시 스피너 정리 — 스택트레이스가 ANSI에 덮이지 않도록
  const cleanupSpinner = () => { try { spinner.stop(); } catch { /* noop */ } };
  process.once('uncaughtException', cleanupSpinner);
  process.once('SIGINT', () => { cleanupSpinner(); process.exit(130); });
  process.once('SIGTERM', () => { cleanupSpinner(); process.exit(143); });

  try {
    await store.initialize();

    spinner.text = 'Loading embedding model...';
    const embedder = createLocalEmbedder(config.embedding.localModel);
    await embedder.initialize();

    spinner.text = 'Starting indexing...';
    const result = await indexVault(vault, {
      store,
      embedder,
      chunkOptions: config.chunking,
      onProgress(current, total, doc) {
        const mb = Math.round(process.memoryUsage().rss / 1024 / 1024);
        if (spinnerEnabled) {
          spinner.text = `[${current}/${total}] ${doc.title} (${mb}MB)`;
        } else if (opts.verbose || current % 50 === 0 || current === total) {
          console.error(`[${current}/${total}] ${doc.title} (${mb}MB)`);
        }
      },
    });

    await store.close();
    spinner.stop();

    // 스킵 사유 집계
    const reasonCount: Record<SkipReason, number> = {
      'empty': 0, 'parse-error': 0, 'binary': 0, 'too-large': 0, 'unreadable': 0,
    };
    for (const s of result.skippedFiles) reasonCount[s.reason]++;

    console.log('');
    console.log(chalk.green('✅ Indexing complete'));
    console.log(`  📁 Files:   ${result.totalFiles} total`);
    console.log(`  📄 Indexed: ${result.indexed} | ⏭️ Unchanged: ${result.skipped} | 🗑️ Deleted: ${result.deleted}${result.failed ? ` | ❌ Failed: ${result.failed}` : ''}`);
    if (result.skippedFiles.length > 0) {
      const parts = Object.entries(reasonCount)
        .filter(([, c]) => c > 0)
        .map(([r, c]) => `${r}=${c}`)
        .join(', ');
      console.log(`  ⚠️  Skipped: ${result.skippedFiles.length} (${parts})`);
    }
    console.log(`  🧩 Chunks:  ${result.totalChunks} | ⏱ ${(result.elapsedMs / 1000).toFixed(1)}s`);
    console.log(`  💾 DB: ${dbPath}`);

    if (opts.logSkipped) {
      writeFileSync(
        opts.logSkipped,
        JSON.stringify({ skipped: result.skippedFiles, failed: result.failedFiles }, null, 2),
      );
      console.log(chalk.dim(`  📋 Skip log: ${opts.logSkipped}`));
    }
  } catch (err) {
    spinner.fail(chalk.red('Indexing failed'));
    const e = err as Error;
    console.error(chalk.red(`\n  ${e.message ?? err}`));
    if (e.stack) console.error(chalk.dim(e.stack.split('\n').slice(1, 5).join('\n')));
    if ((e.message ?? '').match(/heap|out of memory|allocation failed/i)) {
      console.error(chalk.yellow('\n  💡 Hint: large vault detected. Retry with a larger Node heap:'));
      console.error(chalk.yellow('     NODE_OPTIONS="--max-old-space-size=8192 --expose-gc" stellavault index <path>'));
    }
    try { await store.close(); } catch { /* ignore */ }
    process.exit(1);
  }
}
