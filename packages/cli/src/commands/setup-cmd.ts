// Upgrade A1 — `stellavault setup`: connect Stellavault to AI clients in one command.

import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  FILE_CLIENTS, isDetected, writeClientConfig, setupClaudeCode,
  resolveServeCommand, ALL_CLIENT_IDS, type SetupResult,
} from '../mcp-clients.js';

interface SetupOptions {
  client?: string[]; // commander collects repeated --client into an array
  all?: boolean;
  command?: string;
  args?: string;
}

export async function setupCommand(options: SetupOptions) {
  console.log('');
  console.log(chalk.bold('  ✦ Stellavault — Connect to your AI clients'));
  console.log(chalk.dim('  Registering Stellavault as an MCP server.\n'));

  // Gentle nudge: MCP server is useless without an indexed vault.
  if (!existsSync(join(homedir(), '.stellavault.json'))) {
    console.log(
      chalk.yellow('  ⚠ No config found. Run ') +
      chalk.cyan('stellavault init') +
      chalk.yellow(' first to index your vault.\n'),
    );
  }

  const serve = resolveServeCommand({ command: options.command, args: options.args });
  console.log(chalk.dim(`  Server command: ${serve.command} ${serve.args.join(' ')}\n`));

  // Validate any explicit --client ids.
  const requested = options.client && options.client.length > 0
    ? options.client.map(c => c.toLowerCase())
    : null;
  if (requested) {
    const unknown = requested.filter(id => !ALL_CLIENT_IDS.includes(id));
    if (unknown.length > 0) {
      console.log(chalk.red(`  Unknown client(s): ${unknown.join(', ')}`));
      console.log(chalk.dim(`  Valid ids: ${ALL_CLIENT_IDS.join(', ')}\n`));
      return;
    }
  }

  const results: SetupResult[] = [];

  // Claude Code (CLI-based).
  if (!requested || requested.includes('claude-code')) {
    results.push(setupClaudeCode(serve));
  }

  // File-based clients.
  for (const client of FILE_CLIENTS) {
    if (requested && !requested.includes(client.id)) continue;
    // Default run only touches detected clients; --client or --all overrides.
    if (!requested && !options.all && !isDetected(client)) {
      results.push({ client: client.label, status: 'skipped', detail: 'not detected (use --all to force)' });
      continue;
    }
    results.push(writeClientConfig(client, serve));
  }

  // Summary.
  console.log(chalk.bold('  Results:'));
  for (const r of results) {
    const icon =
      r.status === 'written' ? chalk.green('✓ added  ') :
      r.status === 'updated' ? chalk.green('✓ updated') :
      r.status === 'skipped' ? chalk.dim('• skipped') :
      chalk.red('✗ error  ');
    console.log(`    ${icon}  ${chalk.white(r.client)}`);
    if (r.path) console.log(`               ${chalk.dim(r.path)}`);
    if (r.detail) console.log(`               ${chalk.dim(r.detail)}`);
  }

  const ok = results.filter(r => r.status === 'written' || r.status === 'updated').length;
  console.log('');
  if (ok > 0) {
    console.log(
      chalk.green(`  ✦ Connected ${ok} client${ok > 1 ? 's' : ''}.`) +
      chalk.dim(' Restart the app(s) to load Stellavault.'),
    );
  } else {
    console.log(
      chalk.yellow('  No clients configured.') +
      chalk.dim(' Use --all to write configs even when a client is not detected.'),
    );
  }
  console.log('');
}
