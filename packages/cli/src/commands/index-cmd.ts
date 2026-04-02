import ora from 'ora';
import chalk from 'chalk';
import { loadConfig, createSqliteVecStore, createLocalEmbedder, indexVault } from '@stellavault/core';

export async function indexCommand(vaultPath?: string) {
  const config = loadConfig();
  const vault = vaultPath ?? config.vaultPath;
  if (!vault) {
    console.error(chalk.red('Error: vault 경로가 필요합니다. stellavault index <path> 또는 .stellavault.json에 vaultPath 설정'));
    process.exit(1);
  }

  const spinner = ora('초기화 중...').start();

  const store = createSqliteVecStore(config.dbPath);
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
  console.log(`  📄 인덱싱: ${result.indexed}건 | ⏭️ 스킵: ${result.skipped}건 | 🗑️ 삭제: ${result.deleted}건`);
  console.log(`  🧩 청크: ${result.totalChunks}개 | ⏱ ${(result.elapsedMs / 1000).toFixed(1)}초`);
  console.log(`  💾 DB: ${config.dbPath}`);
}
