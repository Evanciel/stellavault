import ora from 'ora';
import chalk from 'chalk';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { loadConfig, createSqliteVecStore, createLocalEmbedder, indexVault, addVault, listVaults } from '@stellavault/core';

// vault 경로 → 고유 DB 경로 생성
function getVaultDbPath(vaultPath: string): string {
  const hash = createHash('sha256').update(vaultPath).digest('hex').slice(0, 8);
  const dir = join(homedir(), '.stellavault', 'vaults');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${hash}.db`);
}

export async function indexCommand(vaultPath?: string) {
  const config = loadConfig();
  const vault = vaultPath ?? config.vaultPath;
  if (!vault) {
    console.error(chalk.red('Error: vault 경로가 필요합니다. stellavault index <path> 또는 .stellavault.json에 vaultPath 설정'));
    process.exit(1);
  }

  // vault별 고유 DB 경로 (multi-vault 지원)
  const dbPath = vaultPath ? getVaultDbPath(vault) : config.dbPath;

  // Cross-Vault에 자동 등록
  const existingVaults = listVaults();
  const vaultName = vault.split(/[/\\]/).filter(Boolean).pop() ?? 'vault';
  if (!existingVaults.some(v => v.path === vault)) {
    try {
      addVault(vaultName.toLowerCase(), vaultName, vault, dbPath);
      console.log(chalk.dim(`  Auto-registered vault: ${vaultName} (${dbPath})`));
    } catch { /* 이미 등록됨 */ }
  }

  const spinner = ora('초기화 중...').start();

  const store = createSqliteVecStore(dbPath);
  await store.initialize();

  spinner.text = '임베딩 모델 로딩 중...';
  const embedder = createLocalEmbedder(config.embedding.localModel);
  await embedder.initialize();

  spinner.text = '인덱싱 시작...';
  const result = await indexVault(vault, {
    store,
    embedder,
    chunkOptions: config.chunking,
    onProgress(current, total, doc) {
      spinner.text = `[${current}/${total}] ${doc.title}`;
    },
  });

  await store.close();
  spinner.stop();

  console.log('');
  console.log(chalk.green('✅ 인덱싱 완료'));
  console.log(`  📄 인덱싱: ${result.indexed}건 | ⏭️ 스킵: ${result.skipped}건 | 🗑️ 삭제: ${result.deleted}건${result.failed ? ` | ❌ 실패: ${result.failed}건` : ''}`);
  console.log(`  🧩 청크: ${result.totalChunks}개 | ⏱ ${(result.elapsedMs / 1000).toFixed(1)}초`);
  console.log(`  💾 DB: ${dbPath}`);
}
