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

    const spinner = ora({ text: '  Loading embedding model (first run downloads ~30MB, please wait)...', indent: 2 }).start();

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

    // If vault was empty, seed 3 sample notes so the first search and graph aren't blank.
    if (result.indexed === 0) {
      console.log(chalk.yellow('\n  Your vault is empty — creating 3 starter notes so you can explore.\n'));

      const rawDir = join(vaultPath, 'raw');
      mkdirSync(rawDir, { recursive: true });

      const samples = [
        {
          file: 'welcome-to-stellavault.md',
          content: `---\ntitle: "Welcome to Stellavault"\ntags: [getting-started]\n---\n\n# Welcome to Stellavault\n\nThis is your self-compiling knowledge base. Drop any note, URL, or file here and Stellavault will organize, index, and connect it automatically.\n\n## How it works\n\n1. **Capture** — Write notes, clip URLs, ingest PDFs\n2. **Organize** — Auto-classify, tag, and link\n3. **Distill** — Find gaps, duplicates, contradictions\n4. **Express** — Draft blog posts, reports from your knowledge\n\nTry: \`stellavault graph\` to see your notes as a 3D neural network.`,
        },
        {
          file: 'spaced-repetition.md',
          content: `---\ntitle: "Spaced Repetition & Memory Decay"\ntags: [learning, memory]\n---\n\n# Spaced Repetition\n\nForgetting is natural. The **Ebbinghaus forgetting curve** shows we lose ~70% of new information within 24 hours.\n\n## FSRS Algorithm\n\nStellavault uses the **Free Spaced Repetition Scheduler** to track which notes are fading from your memory.\n\n- Run \`stellavault decay\` to see what you're forgetting\n- Run \`stellavault review\` for a daily review session\n- Each review strengthens the memory trace\n\n## Why it matters\n\nKnowledge you don't revisit becomes invisible. Spaced repetition surfaces the right note at the right time.`,
        },
        {
          file: 'zettelkasten-method.md',
          content: `---\ntitle: "The Zettelkasten Method"\ntags: [knowledge-management, zettelkasten]\n---\n\n# Zettelkasten\n\nNiklas Luhmann's note-taking system that produced 70+ books and 400+ papers.\n\n## Three stages\n\n1. **Fleeting notes** — Quick ideas captured in raw/\n2. **Literature notes** — Processed from sources\n3. **Permanent notes** — Refined, atomic, interconnected\n\nStellavault follows this flow:\n- \`stellavault fleeting "idea"\` → captures to raw/\n- \`stellavault compile\` → promotes and links\n- \`stellavault promote note.md --to permanent\` → finalizes\n\n## Connection to Karpathy's self-compiling knowledge\n\nAndrej Karpathy's approach: every session auto-compiles into structured knowledge. Stellavault automates this: session-save → flush → wiki.`,
        },
      ];

      for (const s of samples) {
        writeFileSync(join(rawDir, s.file), s.content, 'utf-8');
      }

      // Re-index with the sample notes
      const reSpinner = ora({ text: '  Indexing sample notes...', indent: 2 }).start();
      const reResult = await indexVault(vaultPath, {
        store,
        embedder,
        chunkOptions: { maxTokens: 300, overlap: 50, minTokens: 50 },
      });
      reSpinner.succeed(chalk.green(`  Indexed ${reResult.indexed} sample notes, ${reResult.totalChunks} chunks`));
    }

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

    // Day 2 Experience — 습관화 제안
    console.log(chalk.cyan('  ─── Build a habit ───\n'));
    const setupCron = await ask(rl, '  Auto-run daily briefing? (adds cron job) [Y/n]', 'Y');
    if (setupCron.toLowerCase() !== 'n') {
      const cronLine = `0 9 * * * cd "${vaultPath}" && stellavault brief >> ~/.stellavault/daily.log 2>&1`;
      const platform = process.platform;

      if (platform === 'win32') {
        console.log(chalk.dim('\n  Windows: Add this to Task Scheduler:'));
        console.log(chalk.dim(`  Action: stellavault brief`));
        console.log(chalk.dim(`  Trigger: Daily at 9:00 AM`));
        console.log(chalk.dim(`  Start in: ${vaultPath}\n`));
      } else {
        console.log(chalk.dim('\n  Add this to your crontab (crontab -e):'));
        console.log(chalk.dim(`  ${cronLine}\n`));

        const autoAdd = await ask(rl, '  Add to crontab now? [Y/n]', 'Y');
        if (autoAdd.toLowerCase() !== 'n') {
          try {
            const { execSync } = await import('node:child_process');
            const existing = execSync('crontab -l 2>/dev/null || true', { encoding: 'utf-8' });
            if (!existing.includes('stellavault brief')) {
              execSync(`(crontab -l 2>/dev/null; echo "${cronLine}") | crontab -`, { encoding: 'utf-8' });
              console.log(chalk.green('  ✓ Daily briefing scheduled at 9:00 AM\n'));
            } else {
              console.log(chalk.dim('  Already scheduled.\n'));
            }
          } catch {
            console.log(chalk.yellow('  Could not auto-add. Please add manually.\n'));
          }
        }
      }
    }

    console.log(chalk.dim('  Tomorrow morning, run:'));
    console.log(`  ${chalk.cyan('stellavault brief')}     See what changed overnight`);
    console.log(`  ${chalk.cyan('stellavault decay')}     Review fading knowledge`);
    console.log('');
    console.log(chalk.dim('  Your knowledge is now alive. ✦'));
    console.log('');

  } finally {
    rl.close();
  }
}
