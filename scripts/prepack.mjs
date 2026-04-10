// prepack — Strip `workspaces` field from package.json before npm publishes.
// Without this, npm sees the published package as a workspace root and silently
// skips creating the bin symlink, making `stellavault` command unavailable.
// postpack.mjs restores the original file.

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pkgPath = resolve(root, 'package.json');
const backupPath = resolve(root, 'package.json.prepack-backup');

// Backup original
copyFileSync(pkgPath, backupPath);

// Load and transform
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

// Strip fields that confuse npm consumers
delete pkg.workspaces;

// Strip dev-only scripts that reference workspaces / prepack itself
// (keep a minimal scripts object so `npm run` noise is silent for users)
pkg.scripts = {
  // leave no-op so `npm test` inside dependency doesn't explode
  test: 'echo "no tests in published package" && exit 0',
};

// devDependencies are not needed by consumers and would pull esbuild/playwright
delete pkg.devDependencies;

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log('✓ prepack: stripped workspaces, devDependencies, scripts from package.json');
console.log('  backup: package.json.prepack-backup');
