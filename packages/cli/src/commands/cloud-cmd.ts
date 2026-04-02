// sv cloud sync/restore/status — E2E encrypted cloud backup (F-A04)

import chalk from 'chalk';
import { loadConfig } from '@stellavault/core';
import { syncToCloud, restoreFromCloud, getSyncState } from '@stellavault/core';
import type { CloudConfig } from '@stellavault/core';

function getCloudConfig(): CloudConfig | null {
  const endpoint = process.env.SV_CLOUD_ENDPOINT;
  const bucket = process.env.SV_CLOUD_BUCKET ?? 'stellavault';
  const accessKeyId = process.env.SV_CLOUD_ACCESS_KEY ?? '';
  const secretAccessKey = process.env.SV_CLOUD_SECRET_KEY ?? '';
  const encryptionKey = process.env.SV_CLOUD_ENCRYPTION_KEY;

  if (!endpoint || !secretAccessKey) return null;

  return { endpoint, bucket, accessKeyId, secretAccessKey, encryptionKey };
}

export async function cloudSyncCommand() {
  const cloudConfig = getCloudConfig();
  if (!cloudConfig) {
    console.log(chalk.red('\n  Cloud not configured. Set environment variables:'));
    console.log(chalk.dim('    SV_CLOUD_ENDPOINT=https://xxx.r2.cloudflarestorage.com'));
    console.log(chalk.dim('    SV_CLOUD_SECRET_KEY=your_api_token'));
    console.log(chalk.dim('    SV_CLOUD_ENCRYPTION_KEY=your_passphrase (optional)\n'));
    return;
  }

  const config = loadConfig();
  console.log(chalk.dim('\n  Encrypting and uploading...'));

  const result = await syncToCloud(config.dbPath, cloudConfig);

  if (result.success) {
    console.log(chalk.green('\n  ✅ Cloud sync complete'));
    console.log(`    DB: ${(result.dbSize / 1024).toFixed(0)}KB → Encrypted: ${(result.encryptedSize / 1024).toFixed(0)}KB`);
    console.log(chalk.dim(`    ${result.timestamp}\n`));
  } else {
    console.log(chalk.red(`\n  ❌ Sync failed: ${result.error}\n`));
  }
}

export async function cloudRestoreCommand() {
  const cloudConfig = getCloudConfig();
  if (!cloudConfig) {
    console.log(chalk.red('\n  Cloud not configured. See: sv cloud sync --help\n'));
    return;
  }

  const config = loadConfig();
  console.log(chalk.dim('\n  Downloading and decrypting...'));

  const result = await restoreFromCloud(config.dbPath, cloudConfig);

  if (result.success) {
    console.log(chalk.green('\n  ✅ Restore complete'));
    console.log(`    Encrypted: ${(result.encryptedSize / 1024).toFixed(0)}KB → DB: ${(result.dbSize / 1024).toFixed(0)}KB`);
    console.log(chalk.dim('    Previous DB backed up as .backup\n'));
  } else {
    console.log(chalk.red(`\n  ❌ Restore failed: ${result.error}\n`));
  }
}

export async function cloudStatusCommand() {
  const state = getSyncState();
  if (!state) {
    console.log(chalk.yellow('\n  No cloud sync history. Run: sv cloud sync\n'));
    return;
  }

  console.log(chalk.bold('\n  ☁️  Cloud Sync Status'));
  console.log(`    Last sync: ${state.lastSync}`);
  console.log(`    DB size:   ${(state.dbSize / 1024).toFixed(0)}KB\n`);
}
