// Design Ref: §11.1 — CLI graph-cmd
// Plan SC: SC-04 — stellavault graph → 브라우저 3초

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, createApiServer } from '@stellavault/core';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export async function graphCommand() {
  const config = loadConfig();
  const hub = createKnowledgeHub(config);

  console.error(chalk.dim('⏳ Initializing...'));
  await hub.store.initialize();
  await hub.embedder.initialize();

  const stats = await hub.store.getStats();
  if (stats.documentCount === 0) {
    console.error(chalk.yellow('⚠ No documents indexed. Run `stellavault index <vault-path>` first.'));
    process.exit(1);
  }

  // API 서버 시작
  const port = config.mcp.port || 3333;
  // vault 이름 추출 (경로의 마지막 디렉토리명)
  const vaultName = config.vaultPath
    ? config.vaultPath.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? ''
    : '';
  const api = createApiServer({
    store: hub.store,
    searchEngine: hub.searchEngine,
    port,
    vaultName,
  });
  await api.start();

  console.error(chalk.green('🧠 Stellavault — Neural Knowledge Graph'));
  console.error(`   📚 ${stats.documentCount} documents | ${stats.chunkCount} chunks`);
  console.error(`   🌐 API: http://127.0.0.1:${port}`);

  // Vite dev 서버 시작 시도
  const graphDir = resolve(process.cwd(), 'packages/graph');
  const hasGraph = existsSync(resolve(graphDir, 'package.json'));

  if (hasGraph) {
    console.error(chalk.dim('   🚀 Starting Vite dev server...'));

    const vite = spawn('npx', ['vite', '--host'], {
      cwd: graphDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    vite.stderr.on('data', (data: Buffer) => {
      const line = data.toString();
      // Vite ready 메시지 감지 → 브라우저 열기
      if (line.includes('Local:')) {
        const match = line.match(/http:\/\/localhost:\d+/);
        const url = match?.[0] ?? 'http://localhost:5173';
        console.error(chalk.green(`   🔮 Graph: ${url}`));
        openBrowser(url);
      }
    });

    vite.on('close', () => {
      console.error(chalk.dim('   Vite server stopped'));
    });

    process.on('SIGINT', () => {
      vite.kill();
      process.exit(0);
    });
  } else {
    console.error(chalk.dim('   💡 Graph UI not found. Open http://127.0.0.1:' + port + '/api/graph'));
  }

  console.error(chalk.dim('   Press Ctrl+C to stop'));
}

async function openBrowser(url: string) {
  try {
    const open = await import('open');
    await open.default(url);
  } catch {
    // open 패키지 없으면 무시
  }
}
