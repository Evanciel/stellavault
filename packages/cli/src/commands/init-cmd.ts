// stellavault init — 인터랙티브 온보딩 위저드 (F-A01)

import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import ora from 'ora';
import chalk from 'chalk';
import { loadConfig, createSqliteVecStore, createLocalEmbedder, indexVault, createSearchEngine } from '@stellavault/core';

function ask(rl: ReturnType<typeof createInterface>, question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` ${chalk.dim(`(${defaultVal})`)}` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

export async function initCommand() {
  console.log('');
  console.log(chalk.bold('  ✦ Stellavault Setup Wizard'));
  console.log(chalk.dim('  Notes die in folders. Let\'s bring yours to life.\n'));

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Step 1: Vault Path
    console.log(chalk.cyan('  Step 1/3') + ' — Where is your Obsidian vault?');
    console.log(chalk.dim('  This is the folder containing your .md files.\n'));

    let vaultPath = '';
    while (!vaultPath) {
      const input = await ask(rl, '  Vault path');
      if (!input) {
        console.log(chalk.yellow('  Please enter your vault path.'));
        continue;
      }
      const resolved = input.replace(/^~/, homedir());
      if (!existsSync(resolved)) {
        console.log(chalk.yellow(`  Path not found: ${resolved}`));
        continue;
      }
      vaultPath = resolved;
    }

    console.log(chalk.green(`  ✓ Vault: ${vaultPath}\n`));

    // Save config
    const configDir = join(homedir(), '.stellavault');
    mkdirSync(configDir, { recursive: true });
    const dbPath = join(configDir, 'index.db');

    const configData = {
      vaultPath,
      dbPath,
      embedding: { model: 'local', localModel: 'all-MiniLM-L6-v2' },
      chunking: { maxTokens: 300, overlap: 50, minTokens: 50 },
      search: { defaultLimit: 10, rrfK: 60 },
      mcp: { mode: 'stdio', port: 3333 },
    };
    writeFileSync(join(homedir(), '.stellavault.json'), JSON.stringify(configData, null, 2), 'utf-8');
    console.log(chalk.dim(`  Config saved: ~/.stellavault.json`));

    // Step 2: Indexing
    console.log('');
    console.log(chalk.cyan('  Step 2/3') + ' — Indexing your vault');
    console.log(chalk.dim('  Vectorizing notes with local AI (no data leaves your machine).\n'));

    const spinner = ora({ text: '  Loading embedding model...', indent: 2 }).start();

    const store = createSqliteVecStore(dbPath);
    await store.initialize();

    const embedder = createLocalEmbedder('all-MiniLM-L6-v2');
    await embedder.initialize();
    spinner.text = '  Scanning vault...';

    const result = await indexVault(vaultPath, {
      store,
      embedder,
      chunkOptions: { maxTokens: 300, overlap: 50, minTokens: 50 },
      onProgress(current, total, doc) {
        const pct = Math.round((current / total) * 100);
        const bar = '█'.repeat(Math.floor(pct / 4)) + '░'.repeat(25 - Math.floor(pct / 4));
        spinner.text = `  [${bar}] ${pct}% (${current}/${total}) ${doc.title.slice(0, 30)}`;
      },
    });

    spinner.succeed(chalk.green(`  Indexed ${result.indexed} docs, ${result.totalChunks} chunks (${(result.elapsedMs / 1000).toFixed(1)}s)`));

    // Step 3: First Search
    console.log('');
    console.log(chalk.cyan('  Step 3/3') + ' — Try your first search');
    console.log(chalk.dim('  Type a topic you know about. Stellavault finds connections.\n'));

    const searchEngine = createSearchEngine({ store, embedder, rrfK: 60 });

    let searchDone = false;
    while (!searchDone) {
      const query = await ask(rl, '  Search');
      if (!query) {
        console.log(chalk.dim('  Type something, or press Ctrl+C to skip.'));
        continue;
      }

      const searchSpinner = ora({ text: '  Searching...', indent: 2 }).start();
      const results = await searchEngine.search({ query, limit: 5 });
      searchSpinner.stop();

      if (results.length === 0) {
        console.log(chalk.yellow('  No results. Try a different topic.'));
        continue;
      }

      console.log('');
      for (const r of results) {
        const score = Math.round(r.score * 100);
        const bar = score >= 70 ? chalk.green('●') : score >= 40 ? chalk.yellow('●') : chalk.dim('●');
        console.log(`  ${bar} ${chalk.bold(r.document.title)} ${chalk.dim(`(${score}%)`)}`);
        if (r.highlights[0]) {
          console.log(`    ${chalk.dim(r.highlights[0].slice(0, 80))}...`);
        }
      }
      console.log('');
      searchDone = true;
    }

    await store.close();

    // Done!
    console.log(chalk.bold.green('  ✦ Setup complete!\n'));
    console.log('  What\'s next:');
    console.log(`  ${chalk.cyan('stellavault graph')}     Launch 3D knowledge graph`);
    console.log(`  ${chalk.cyan('stellavault decay')}     See what knowledge is fading`);
    console.log(`  ${chalk.cyan('stellavault brief')}     Get your daily knowledge briefing`);
    console.log(`  ${chalk.cyan('stellavault serve')}     Connect AI agents via MCP`);
    console.log('');
    console.log(chalk.dim('  Your knowledge is now alive. ✦'));
    console.log('');

  } finally {
    rl.close();
  }
}
