// Design Ref: stellavault sync — Notion↔Obsidian 동기화 CLI 통합

import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export async function syncCommand(options: { upload?: boolean; watch?: boolean }) {
  const syncDir = resolve(process.cwd(), 'packages/sync');
  const syncScript = resolve(syncDir, 'sync-to-obsidian.mjs');

  if (!existsSync(syncScript)) {
    console.error(chalk.red('❌ packages/sync/sync-to-obsidian.mjs not found'));
    console.error(chalk.dim('   Run from project root: cd notion-obsidian-sync'));
    process.exit(1);
  }

  // .env 확인
  const envFile = resolve(syncDir, '.env');
  if (!existsSync(envFile)) {
    console.error(chalk.red('❌ packages/sync/.env not found'));
    console.error(chalk.dim('   Copy .env.example → .env and set NOTION_TOKEN'));
    process.exit(1);
  }

  if (options.upload) {
    // PDCA 문서 → Notion 업로드
    const uploadScript = resolve(syncDir, 'upload-pdca-to-notion.mjs');
    if (!existsSync(uploadScript)) {
      console.error(chalk.red('❌ upload-pdca-to-notion.mjs not found'));
      process.exit(1);
    }
    console.error(chalk.dim('📤 Uploading PDCA documents to Notion...'));
    await runScript(uploadScript, syncDir);
  } else {
    // Notion → Obsidian 동기화
    console.error(chalk.dim('🔄 Syncing Notion → Obsidian...'));
    await runScript(syncScript, syncDir);

    if (options.watch) {
      console.error(chalk.green('👀 Watch mode — syncing every 5 minutes'));
      setInterval(async () => {
        console.error(chalk.dim(`🔄 [${new Date().toLocaleTimeString()}] Re-syncing...`));
        await runScript(syncScript, syncDir);
      }, 5 * 60 * 1000);

      // Keep alive
      process.stdin.resume();
    }
  }
}

function runScript(scriptPath: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {
      cwd,
      stdio: 'inherit',
      shell: false,
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Script exited with code ${code}`));
    });

    child.on('error', reject);
  });
}
