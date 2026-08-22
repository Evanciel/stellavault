// stellavault pack — Knowledge Pack 관리

import chalk from 'chalk';
import { resolve, join } from 'node:path';
import { readdirSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  loadConfig, createKnowledgeHub,
  createPack, exportPack, importPack, packToSummary, packImportSucceeded,
  checkVaultOwnership, VAULT_OWNER_KEY,
} from '@stellavault/core';
import { resolve as resolvePath } from 'node:path';
import { refuseForeignDbEarly } from '../db-guard.js';

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
  // 🔴 DB 를 <열기 전에> 각인을 묻는다. `initialize()` 는 여는 것만으로
  //    WAL 전환·CREATE TABLE·ALTER TABLE 을 남의 DB 에 실행한다.
  refuseForeignDbEarly(config.dbPath, config.vaultPath ?? '', 'pack create');
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
  // 🔴 여는 것 자체가 WAL·스키마를 쓴다 — 그 전에 묻는다 (코덱스 15차 P1).
  refuseForeignDbEarly(config.dbPath, config.vaultPath ?? '', 'pack import');
  const hub = createKnowledgeHub(config);
  await hub.store.initialize();
  await hub.embedder.initialize();

  // 🔴🔴 소유를 <묻고> 쓴다 (코덱스 14차 P1).
  //
  //   `importPack` 은 볼트 경로를 인자로 받지 않는다 — 그래서 색인기가 세운 가드가
  //   여기엔 하나도 안 걸리고, 설정의 `dbPath` 가 남의 볼트를 가리켜도 그대로 쓴다.
  //   실제로 사용자의 `~/.stellavault/vaults.json` 에 <파일 2개짜리 테스트 볼트가
  //   실볼트의 DB 를 가리키는> 항목이 남아 있다. 색인 경로는 그것을 거부하지만
  //   팩 경로는 안 거부했다.
  //
  //   ⚠️ 여기서 <각인하지 않는다>. 각인의 주인은 색인기다(§ index-cmd 의 같은 규칙).
  //   팩 가져오기는 볼트를 스캔하지 않으므로 겹침을 물을 수단 자체가 없다 —
  //   물을 수 없는 쪽이 판정을 내리면 안 된다. 할 수 있는 일은 <이미 확정된 어긋남>을
  //   거부하는 것뿐이고, 그것만 한다.
  const packOwnership = checkVaultOwnership(
    hub.store.getMeta(VAULT_OWNER_KEY),
    resolvePath(config.vaultPath ?? ''),
  );
  // 🔴🔴 <각인이 확정된 DB 에만> 쓴다 (코덱스 15차 P1). 14차에는 `mismatch` 만 막았는데
  //   그러면 <각인 없는> DB 는 그대로 통과한다 — 규칙 2("증거가 없으면 한 글자도 안 쓴다")를
  //   팩 경로만 면제해 준 셈이었다. 팩 가져오기는 볼트를 스캔하지 않으므로 겹침을 물을
  //   수단이 아예 없고, 그러니 <물을 수 있는 쪽>이 먼저 답을 내야 한다.
  //   ★부수 효과: 각인 없는 DB 에 팩 행이 먼저 생기는 일이 사라진다. 그 상태였다면
  //    배치 색인이 "문서가 있다" 며 영영 거부했을 것이다(15차 P2 가 짚은 회귀).
  // 🔴 16차 P1: 한때 `config.vaultPath &&` 로 시작했는데, 그러면 볼트 경로가 <비었을 때>
  //    조건 전체가 거짓이 되어 `mismatch` 든 `claim` 이든 <그대로 통과>했다.
  //    ★"판정에 필요한 값이 없다" 는 통과 사유가 아니다 — 그것이야말로 <모르는 상태>다.
  //     여기서 통과시키면 규칙 7 이 딱 그 경우에만 면제된다.
  if (packOwnership.kind !== 'ok') {
    const why = !config.vaultPath
      ? '지금 볼트 경로를 모른다 — 이 DB 가 어느 볼트 것인지 물을 수가 없다'
      : packOwnership.kind === 'mismatch'
      ? '이 DB 는 다른 볼트의 것이다'
      : '이 DB 에 볼트 각인이 없다 — 이 DB 가 이 볼트의 것이라는 증거가 없다';
    console.error(chalk.red(`🔴 ${why} — 팩을 가져오지 않는다.`));
    console.error(chalk.dim(`   DB 의 볼트: ${packOwnership.kind === 'mismatch' ? packOwnership.owner : '(각인 없음)'}`));
    console.error(chalk.dim(`   지금 볼트 : ${resolvePath(config.vaultPath ?? '')}`));
    if (packOwnership.kind === 'claim') {
      console.error(chalk.dim('   `stellavault index <볼트>` 로 전체 색인을 한 번 돌려 소유를 확정하라.'));
    }
    await hub.store.close();
    process.exit(1);
  }

  console.error(chalk.dim('⏳ Importing pack...'));
  const result = await importPack(hub.store, hub.embedder, absPath);

  // 🔴 <아무것도 안 썼는데> 초록 "Imported: 0 chunks" 로 끝나던 자리 (코덱스 13차 P2).
  //    importer 는 청크가 0개면 기존 팩을 보존하려고 <아무것도 쓰지 않고> 정상 반환한다.
  //    그 결과를 성공으로 찍으면 자동화가 "가져왔다" 로 읽고 다음 단계로 간다.
  const wroteNothing = !packImportSucceeded(result);
  if (result.skipped > 0) console.error(chalk.yellow(`   ⏭️ Skipped: ${result.skipped}`));
  if (result.modelMismatch) {
    console.error(chalk.yellow(`   ⚠️ Model mismatch — ${result.reEmbedded} chunks re-embedded`));
  }

  await hub.store.close();

  if (wroteNothing) {
    console.error(chalk.red('🔴 가져온 청크가 0개다 — 아무것도 쓰지 않았다.'));
    // 🔴 자동화는 문구가 아니라 <종료 코드>를 본다.
    process.exit(1);
  }
  console.error(chalk.green(`✅ Imported: ${result.imported} chunks`));
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
