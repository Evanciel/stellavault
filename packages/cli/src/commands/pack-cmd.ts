// stellavault pack — Knowledge Pack 관리

import chalk from 'chalk';
import { resolve, join } from 'node:path';
import { readdirSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  loadConfig, createKnowledgeHub,
  createPack, exportPack, importPack, packToSummary,
} from '@stellavault/core';

const PACKS_DIR = join(homedir(), '.stellavault', 'packs');

export async function packCreateCommand(name: string, options: {
  fromSearch?: string;
  fromCluster?: string;
  author?: string;
  license?: string;
  description?: string;
  limit?: string;
}) {
  const config = loadConfig();
  const hub = createKnowledgeHub(config);
  await hub.store.initialize();
  await hub.embedder.initialize();

  console.error(chalk.dim('⏳ Creating pack...'));

  const { pack, piiReport } = await createPack(hub.store, hub.searchEngine, hub.embedder, {
    name,
    fromSearch: options.fromSearch,
    fromCluster: options.fromCluster ? parseInt(options.fromCluster) : undefined,
    author: options.author ?? 'anonymous',
    license: options.license ?? 'CC-BY-4.0',
    description: options.description,
    limit: options.limit ? parseInt(options.limit) : 100,
  });

  mkdirSync(PACKS_DIR, { recursive: true });
  const outPath = join(PACKS_DIR, `${name}.sv-pack`);
  exportPack(pack, outPath);

  console.error(chalk.green(`✅ Pack created: ${name}`));
  console.error(`   📦 ${pack.chunks.length} chunks`);
  console.error(`   💾 ${outPath}`);
  if (piiReport.redactedCount > 0) {
    console.error(chalk.yellow(`   🔒 PII masked: ${piiReport.redactedCount} items (${piiReport.types.join(', ')})`));
  }

  await hub.store.close();
}

export async function packExportCommand(name: string, options: { output?: string }) {
  const srcPath = join(PACKS_DIR, `${name}.sv-pack`);
  if (!existsSync(srcPath)) {
    console.error(chalk.red(`❌ Pack not found: ${name}`));
    process.exit(1);
  }

  const outPath = resolve(process.cwd(), options.output ?? `${name}.sv-pack`);
  const content = readFileSync(srcPath, 'utf-8');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, content);

  console.error(chalk.green(`✅ Exported: ${outPath}`));
}

export async function packImportCommand(filePath: string) {
  const absPath = resolve(process.cwd(), filePath);
  if (!existsSync(absPath)) {
    console.error(chalk.red(`❌ File not found: ${absPath}`));
    process.exit(1);
  }

  const config = loadConfig();
  const hub = createKnowledgeHub(config);
  await hub.store.initialize();
  await hub.embedder.initialize();

  console.error(chalk.dim('⏳ Importing pack...'));
  const result = await importPack(hub.store, hub.embedder, absPath);

  console.error(chalk.green(`✅ Imported: ${result.imported} chunks`));
  if (result.skipped > 0) console.error(chalk.yellow(`   ⏭️ Skipped: ${result.skipped}`));
  if (result.modelMismatch) {
    console.error(chalk.yellow(`   ⚠️ Model mismatch — ${result.reEmbedded} chunks re-embedded`));
  }

  await hub.store.close();
}

export async function packListCommand() {
  mkdirSync(PACKS_DIR, { recursive: true });
  const files = readdirSync(PACKS_DIR).filter(f => f.endsWith('.sv-pack'));

  if (files.length === 0) {
    console.error(chalk.dim('No packs found. Create one: stellavault pack create <name> --from-search <query>'));
    return;
  }

  console.error(chalk.green(`📦 ${files.length} packs in ${PACKS_DIR}\n`));
  for (const file of files) {
    try {
      const pack = JSON.parse(readFileSync(join(PACKS_DIR, file), 'utf-8'));
      console.error(`  ${chalk.bold(pack.name)} v${pack.version} — ${pack.chunks.length} chunks (${pack.license})`);
    } catch {
      console.error(`  ${file} (invalid)`);
    }
  }
}

export async function packInfoCommand(name: string) {
  const filePath = join(PACKS_DIR, `${name}.sv-pack`);
  if (!existsSync(filePath)) {
    console.error(chalk.red(`❌ Pack not found: ${name}`));
    process.exit(1);
  }

  const pack = JSON.parse(readFileSync(filePath, 'utf-8'));
  console.error(packToSummary(pack));
}
