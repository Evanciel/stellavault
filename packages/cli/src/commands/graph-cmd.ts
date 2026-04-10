// Design Ref: §11.1 — CLI graph-cmd
// Plan SC: SC-04 — stellavault graph → 브라우저 3초

import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, createApiServer } from '@stellavault/core';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Locate the bundled graph UI (produced by scripts/bundle-cli.mjs).
 *
 * Looks in two places, in order:
 *   1. `dist/graph-ui/` — this is where the published npm package puts it,
 *      sibling to the single-file bundle `dist/stellavault.js`.
 *   2. `packages/graph/dist/` — dev source tree layout, when running without
 *      a published bundle.
 *
 * Returns absolute path to the directory containing `index.html`, or null
 * if neither location is populated.
 */
function locateBundledGraphUi(): string | null {
  // At runtime, `import.meta.url` resolves to the ACTUALLY EXECUTING file.
  // - Published package: .../node_modules/stellavault/dist/stellavault.js
  // - Dev source tree:   .../packages/cli/dist/commands/graph-cmd.js
  try {
    const here = dirname(fileURLToPath(import.meta.url));

    // Path 1: bundled install — sibling directory
    const bundled = resolve(here, 'graph-ui');
    if (existsSync(resolve(bundled, 'index.html'))) return bundled;

    // Path 2: walk up from dev dist toward monorepo root
    // packages/cli/dist/commands → ../../../graph/dist
    const monorepoGraphDist = resolve(here, '..', '..', '..', 'graph', 'dist');
    if (existsSync(resolve(monorepoGraphDist, 'index.html'))) return monorepoGraphDist;

    // Path 3: walk up further for the bundled single-file case that lives at
    // <pkg>/dist/stellavault.js (graph-ui is literal sibling)
    const singleFileBundle = resolve(here, '..', 'dist', 'graph-ui');
    if (existsSync(resolve(singleFileBundle, 'index.html'))) return singleFileBundle;
  } catch {
    // fileURLToPath can throw under unusual loaders — fall through to null
  }
  return null;
}

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

  const port = config.mcp.port || 3333;
  const vaultName = config.vaultPath
    ? config.vaultPath.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? ''
    : '';

  // Resolve bundled graph UI BEFORE starting the API server so the server
  // can register static-file routes.
  const graphUiPath = locateBundledGraphUi();

  const api = createApiServer({
    store: hub.store,
    searchEngine: hub.searchEngine,
    port,
    vaultName,
    vaultPath: config.vaultPath,
    graphUiPath: graphUiPath ?? undefined,
  });

  try {
    await api.start();
  } catch (err: any) {
    if (err?.code === 'EADDRINUSE') {
      console.error(chalk.red(`Port ${port} is already in use.`));
      console.error(chalk.dim(`Stop the other process or use a different port:`));
      console.error(chalk.dim(`  Edit .stellavault.json: { "mcp": { "port": ${port + 1} } }`));
      process.exit(1);
    }
    throw err;
  }

  console.error(chalk.green('🧠 Stellavault — Neural Knowledge Graph'));
  console.error(`   📚 ${stats.documentCount} documents | ${stats.chunkCount} chunks`);
  console.error(`   🌐 API: http://127.0.0.1:${port}`);

  if (graphUiPath) {
    // Bundled UI is served directly by the API server on the same port.
    const url = `http://127.0.0.1:${port}/`;
    console.error(chalk.green(`   🔮 Graph: ${url}`));
    console.error(chalk.dim(`   Press Ctrl+C to stop`));
    openBrowser(url);

    process.on('SIGINT', () => process.exit(0));
    return;
  }

  // Dev fallback: no bundled UI → try to spawn Vite from packages/graph/ in the cwd.
  // This is the path used when running `node dist/stellavault.js graph` from the
  // monorepo root during development.
  const devGraphDir = resolve(process.cwd(), 'packages/graph');
  const hasDevGraph = existsSync(resolve(devGraphDir, 'package.json'));

  if (hasDevGraph) {
    console.error(chalk.dim('   🚀 Starting Vite dev server...'));

    const vite = spawn('npx', ['vite', '--host'], {
      cwd: devGraphDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    vite.stderr.on('data', (data: Buffer) => {
      const line = data.toString();
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
    console.error(chalk.yellow('   ⚠ Bundled graph UI missing. Reinstall stellavault: npm i -g stellavault@latest'));
  }

  console.error(chalk.dim('   Press Ctrl+C to stop'));
}

async function openBrowser(url: string) {
  try {
    const open = await import('open');
    await open.default(url);
  } catch {
    // open package absent — ignore
  }
}
