// postpack — Restore the original package.json that prepack.mjs backed up.
// Runs whether npm pack / npm publish succeeded or failed.

import { existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pkgPath = resolve(root, 'package.json');
const backupPath = resolve(root, 'package.json.prepack-backup');

if (existsSync(backupPath)) {
  renameSync(backupPath, pkgPath);
  console.log('✓ postpack: restored package.json from backup');
} else {
  console.log('postpack: no backup found (nothing to restore)');
}
