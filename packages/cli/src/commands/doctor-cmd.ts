// stellavault doctor — diagnose setup issues in one command.
// Checks config, vault, DB, embedder, Node version, and gives actionable fixes.

import chalk from 'chalk';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
  fix?: string;
}

export async function doctorCommand() {
  console.log('');
  console.log(chalk.bold('  🩺 Stellavault Doctor\n'));

  const checks: Check[] = [];

  // 1. Node.js version
  const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    name: 'Node.js version',
    pass: nodeVersion >= 20,
    detail: `v${process.versions.node}`,
    fix: nodeVersion < 20 ? 'Download Node.js 20+: https://nodejs.org' : undefined,
  });

  // 2. Config file exists
  const configPaths = [
    join(process.cwd(), '.stellavault.json'),
    join(homedir(), '.stellavault.json'),
  ];
  const configPath = configPaths.find(p => existsSync(p));
  checks.push({
    name: 'Config file',
    pass: !!configPath,
    detail: configPath ? configPath : 'not found',
    fix: !configPath ? 'Run: stellavault init' : undefined,
  });

  // 3. Parse config + vault path
  let vaultPath = '';
  let dbPath = '';
  if (configPath) {
    try {
      const { readFileSync } = await import('node:fs');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      vaultPath = config.vaultPath || '';
      dbPath = config.dbPath || '';
    } catch (err: any) {
      checks.push({
        name: 'Config valid JSON',
        pass: false,
        detail: err.message,
        fix: `Delete ${configPath} and re-run: stellavault init`,
      });
    }
  }

  // 4. Vault path exists
  if (vaultPath) {
    const vaultExists = existsSync(vaultPath);
    checks.push({
      name: 'Vault path',
      pass: vaultExists,
      detail: vaultExists ? vaultPath : `${vaultPath} (not found)`,
      fix: !vaultExists ? `Create the folder or re-run: stellavault init` : undefined,
    });

    // 5. Vault has .md files
    if (vaultExists) {
      try {
        const { readdirSync } = await import('node:fs');
        const files = readdirSync(vaultPath, { recursive: true });
        const mdCount = (files as string[]).filter(f => typeof f === 'string' && f.endsWith('.md')).length;
        checks.push({
          name: 'Markdown files in vault',
          pass: mdCount > 0,
          detail: `${mdCount} .md files`,
          fix: mdCount === 0 ? 'Add some .md notes to your vault, then run: stellavault index' : undefined,
        });
      } catch {
        checks.push({
          name: 'Vault readable',
          pass: false,
          detail: 'Cannot read vault directory',
          fix: 'Check file permissions on your vault folder',
        });
      }
    }
  }

  // 6. Database exists
  if (dbPath) {
    const dbExists = existsSync(dbPath);
    checks.push({
      name: 'Database',
      pass: dbExists,
      detail: dbExists ? `${dbPath} (${formatBytes(statSync(dbPath).size)})` : `${dbPath} (not found)`,
      fix: !dbExists ? 'Run: stellavault index' : undefined,
    });
  } else if (configPath) {
    checks.push({
      name: 'Database path',
      pass: false,
      detail: 'dbPath not set in config',
      fix: 'Re-run: stellavault init',
    });
  }

  // 7. Embedder model cached
  const cacheDir = join(homedir(), '.cache', 'onnxruntime');
  const hfCache = join(homedir(), '.cache', 'huggingface');
  const xenovaCache = join(homedir(), '.cache', 'xenova');
  const modelCached =
    existsSync(cacheDir) ||
    existsSync(hfCache) ||
    existsSync(xenovaCache) ||
    existsSync(join(homedir(), '.cache', 'transformers'));
  checks.push({
    name: 'Embedding model cached',
    pass: modelCached,
    detail: modelCached ? 'local model files found' : 'not downloaded yet',
    fix: !modelCached ? 'Will download automatically on first index (~30MB)' : undefined,
  });

  // 8. Write permission
  const testDir = join(homedir(), '.stellavault');
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(testDir, { recursive: true });
    checks.push({ name: 'Write permission (~/.stellavault)', pass: true, detail: 'OK' });
  } catch {
    checks.push({
      name: 'Write permission (~/.stellavault)',
      pass: false,
      detail: 'Cannot write to home directory',
      fix: 'Check disk space and permissions on your home folder',
    });
  }

  // ─── Output ───

  let passCount = 0;
  for (const c of checks) {
    const icon = c.pass ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${icon} ${c.name}  ${chalk.dim('—')}  ${c.pass ? chalk.dim(c.detail) : chalk.yellow(c.detail)}`);
    if (c.fix) console.log(`    ${chalk.dim('Fix:')} ${c.fix}`);
    if (c.pass) passCount++;
  }

  console.log('');
  if (passCount === checks.length) {
    console.log(chalk.green.bold(`  All ${checks.length} checks passed. You're good to go! ✦\n`));
  } else {
    const failCount = checks.length - passCount;
    console.log(chalk.yellow(`  ${failCount} issue${failCount > 1 ? 's' : ''} found. Fix them and re-run: stellavault doctor\n`));
  }

  process.exit(passCount === checks.length ? 0 : 1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
