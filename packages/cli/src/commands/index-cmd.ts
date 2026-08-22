import ora from 'ora';
import chalk from 'chalk';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { loadConfig, createSqliteVecStore, createLocalEmbedder, indexVault, addVault, listVaults,
         checkVaultOwnership, VAULT_OWNER_KEY } from '@stellavault/core';
import { refuseForeignDbEarly } from '../db-guard.js';
import type { SkipReason } from '@stellavault/core';

interface IndexOpts {
  noSpinner?: boolean;
  verbose?: boolean;
  logSkipped?: string;
  profileMemory?: boolean;
}

function getVaultDbPath(vaultPath: string): string {
  const hash = createHash('sha256').update(vaultPath).digest('hex').slice(0, 8);
  const dir = join(homedir(), '.stellavault', 'vaults');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${hash}.db`);
}

/** Resolve final DB path with explicit precedence (2026-05-15):
 *    1. STELLAVAULT_DB_PATH env (explicit override — wins always)
 *    2. config.dbPath (from .stellavault.json)
 *    3. vault-hash-based path (~/.stellavault/vaults/<hash>.db) — fallback
 *
 *  Before this fix the CLI ignored the env entirely when a vault path
 *  argument was passed, forcing downstream consumers (e.g. embedded MCP
 *  servers, daily reindex scripts) to copy the DB file between locations.
 */
function resolveDbPath(vault: string, configDbPath: string | undefined): string {
  const envDbPath = process.env.STELLAVAULT_DB_PATH?.trim();
  if (envDbPath) return envDbPath;
  if (configDbPath) return configDbPath;
  return getVaultDbPath(vault);
}

export async function indexCommand(vaultPath?: string, opts: IndexOpts = {}) {
  if (opts.profileMemory) process.env.STELLAVAULT_PROFILE_MEMORY = '1';

  const config = loadConfig();
  const vault = vaultPath ?? config.vaultPath;
  if (!vault) {
    console.error(chalk.red('Error: vault path required. Use stellavault index <path> or set vaultPath in .stellavault.json'));
    process.exit(1);
  }

  const dbPath = resolveDbPath(vault, config.dbPath);

  // 🔴 자동 등록은 <소유권을 확인한 뒤에> 한다 (코덱스 10차 P2).
  //    예전에는 여기서 먼저 등록했다 — 잘못된 볼트·DB 짝을 <영구 설정에 박아 놓고>
  //    그 다음에야 "아무것도 하지 않는다" 고 멈췄다. 아무것도 안 한 것이 아니었다.
  const registerVaultIfNew = () => {
    const vaultName = vault.split(/[/\\]/).filter(Boolean).pop() ?? 'vault';
    if (listVaults().some(v => v.path === vault)) return;
    try {
      addVault(vaultName.toLowerCase(), vaultName, vault, dbPath);
      console.log(chalk.dim(`  Auto-registered vault: ${vaultName} (${dbPath})`));
    } catch { /* 이미 등록됨 */ }
  };

  // 🔴🔴 DB 를 <열기 전에> 각인을 묻는다 (코덱스 14차 P1).
  //
  //   아래 `store.initialize()` 는 여는 것만으로 `journal_mode = WAL` 과
  //   `CREATE TABLE IF NOT EXISTS` · `ALTER TABLE` 마이그레이션을 실행한다. 즉
  //   <남의 DB 라고 판정하기도 전에> 그 파일을 이미 바꿔 놓는다. 코덱스가 13·14차
  //   연속으로 이것을 지적했고, 두 번은 주석으로 약속을 좁혀 넘겼다. 세 번째에 고친다.
  //
  //   `peekVaultOwner` 는 `readonly: true` + `fileMustExist: true` 로 열어 각인만 읽는다.
  //   ⚠️ 이것은 <거부 전용>이다. 통과해도 아래 정식 판정을 건너뛰지 않는다 —
  //      여기서 승인까지 하면 판정이 두 곳이 되고, 그러면 어느 쪽이 결정했는지 모른다.
  //      (이 저장소가 CLI 쪽 각인을 지웠던 이유와 같다: 중복 판정은 변이가 안 잡힌다.)
  //    ★같은 검사를 다섯 명령이 쓴다. 손으로 다섯 번 쓰면 여섯 번째가 빠진다 —
  //     실제로 14차에는 이 명령 하나에만 있었다 (코덱스 15차 P1).
  refuseForeignDbEarly(dbPath, vault, `index "${vault}"`);

  // TTY 감지 + 플래그 기반 스피너 활성화 제어
  const spinnerEnabled = !opts.noSpinner && !opts.verbose && process.stderr.isTTY;
  const spinner = ora({ text: 'Initializing...', isEnabled: spinnerEnabled }).start();
  const store = createSqliteVecStore(dbPath);

  // 크래시 시 스피너 정리 — 스택트레이스가 ANSI에 덮이지 않도록
  const cleanupSpinner = () => { try { spinner.stop(); } catch { /* noop */ } };
  process.once('uncaughtException', cleanupSpinner);
  process.once('SIGINT', () => { cleanupSpinner(); process.exit(130); });
  process.once('SIGTERM', () => { cleanupSpinner(); process.exit(143); });

  try {
    await store.initialize();

    // 🔴🔴 이 DB 가 <이 볼트의 것인지> 먼저 묻는다. 아니면 아무것도 하지 않는다.
    //
    // resolveDbPath 는 `config.dbPath` 를 볼트 인자보다 <위에> 둔다(위 주석 참조).
    // 그래서 `stellavault index /어딘가/작은폴더` 처럼 <다른 볼트를 인자로 주어도>
    // 설정에 적힌 DB 에 붙는다. 그러면 indexVault 가 "디스크에 없는 문서" 를 지우면서
    // <원래 볼트의 색인을 통째로 날린다>. 실측 2026-08-21: 파일 2개짜리 스크래치
    // 폴더를 색인하니 `Deleted: 17376` — 그 볼트의 색인이 전부 사라졌다.
    //
    // ★그 삭제는 <규칙상 올바른> 동작이라 어떤 삭제 가드로도 못 막는다. 실패도 없었고
    //  못 읽은 파일도 없었다. 막아야 하는 지점은 삭제가 아니라 <짝짓기>다.
    // → DB 에 볼트를 각인하고, 어긋나면 색인을 시작하기 전에 멈춘다.
    // 🔴 여기서는 <각인하지 않는다>. 각인의 주인은 core 의 indexVault 다 — 지우는 코드가
    //    거기 있으니 판정도 거기 있어야 하고, 두 곳이 쓰면 어느 쪽이 썼는지 알 수 없어진다.
    //    (실측: CLI 쪽 각인을 지우는 변이가 <살아남았다> — 중복이라 아무것도 안 바뀐다.)
    //    이 자리에 남는 일은 하나뿐이다: 어긋났을 때 <대화형으로 크게 멈추는 것>.
    const ownership = checkVaultOwnership(store.getMeta(VAULT_OWNER_KEY), resolve(vault));
    if (ownership.kind === 'mismatch') {
      spinner.stop();
      await store.close();
      console.error(chalk.red('Error: 이 DB 는 다른 볼트의 것이다 — 색인을 중단한다.'));
      console.error(`  DB       : ${dbPath}`);
      console.error(`  DB 의 볼트: ${ownership.owner}`);
      console.error(`  지금 볼트 : ${ownership.here}`);
      console.error('');
      // (레지스트리에 <등록하지 않고> 끝낸다 — 잘못된 짝을 설정에 남기지 않는다)
      console.error(chalk.yellow('  그대로 진행하면 DB 에 있던 문서가 "디스크에 없다"로 판정되어 전부 지워진다.'));
      console.error('  이 볼트를 따로 색인하려면 DB 를 분리하라:');
      console.error(`    STELLAVAULT_DB_PATH=<다른경로.db> stellavault index "${vault}"`);
      process.exit(1);
    }

    // 🔴 등록은 <여기서 하지 않는다> (코덱스 11차 P2). CLI 의 checkVaultOwnership 은
    //    "각인 없음" 과 "짝이 맞음" 을 구별할 정보가 없다 — 각인 경합에 지거나 겹침이
    //    약해도 여기까지 온다. 그때 등록하면 <잘못된 볼트·DB 짝>이 영구 설정에 남고,
    //    그 뒤로는 그것이 기본값처럼 쓰인다. core 가 판정한 <뒤로> 미룬다.

    spinner.text = 'Loading embedding model...';
    const embedder = createLocalEmbedder(config.embedding.localModel);
    await embedder.initialize();

    spinner.text = 'Starting indexing...';
    const result = await indexVault(vault, {
      store,
      embedder,
      chunkOptions: config.chunking,
      onProgress(current, total, doc) {
        const mb = Math.round(process.memoryUsage().rss / 1024 / 1024);
        if (spinnerEnabled) {
          spinner.text = `[${current}/${total}] ${doc.title} (${mb}MB)`;
        } else if (opts.verbose || current % 50 === 0 || current === total) {
          console.error(`[${current}/${total}] ${doc.title} (${mb}MB)`);
        }
      },
    });

    await store.close();
    spinner.stop();

    // 🔴 core 가 <실제로 이 볼트의 것이라고 판정한 뒤에만> 등록한다 (코덱스 11차 P2).
    if (!result.foreignDb && !result.ownershipUnverified) registerVaultIfNew();

    // 스킵 사유 집계
    const reasonCount: Record<SkipReason, number> = {
      'empty': 0, 'parse-error': 0, 'binary': 0, 'too-large': 0, 'unreadable': 0,
    };
    for (const s of result.skippedFiles) reasonCount[s.reason]++;

    console.log('');
    // 🔴 아무것도 안 했을 때 초록 "complete" 는 <거짓>이다 (코덱스 11차 P2).
    const didNothing = result.foreignDb === true || result.ownershipUnverified === true;
    console.log(didNothing
      ? chalk.red('🔴 색인하지 않았다 — 이 DB 가 이 볼트의 것이라는 증거가 없다')
      : chalk.green('✅ Indexing complete'));
    console.log(`  📁 Files:   ${result.totalFiles} total`);
    console.log(`  📄 Indexed: ${result.indexed} | ⏭️ Unchanged: ${result.skipped} | 🗑️ Deleted: ${result.deleted}${result.failed ? ` | ❌ Failed: ${result.failed}` : ''}`);
    // 🔴 유령을 <조용히> 남기지 않는다. 삭제를 미뤘으면 화면에 뜬다 (코덱스 7차 P2).
    if (result.deferredDeletes > 0) {
      // 🔴 원인이 다르면 할 일도 다르다 — 한 문장으로 뭉치면 잘못된 처방을 준다
      //    (코덱스 10차 P2). 실패·못 읽음은 <고치면> 되지만, 각인이 약해서 미룬
      //    것이라면 고칠 것이 없고 <볼트/DB 짝이 맞는지>를 봐야 한다.
      const why = result.failed > 0
        ? '실패한 파일이 있어 미뤘다. 원인을 고치고 다시 색인하라.'
        : '이번 실행이 불완전하거나 이 DB 가 이 볼트의 것인지 확실하지 않아 미뤘다. '
          + '위의 [index] 경고를 읽어 어느 쪽인지 확인하라.';
      console.log(chalk.yellow(`  👻 Deferred deletes: ${result.deferredDeletes} — ${why}`));
    }
    // 🔴 "아무것도 안 했다" 와 "색인은 했는데 소유가 미확인" 은 <다른 사건>이다.
    //    한 이름으로 뭉쳤더니 후자에도 "아무것도 하지 않았다" 고 찍었다 (코덱스 10차 P2).
    if (result.foreignDb) {
      console.log(chalk.red('  🔴 이 DB 는 다른 볼트의 것이라 <아무것도 하지 않았다>.'));
    } else if (result.ownershipUnverified) {
      // 🔴 한때 여기 "삭제만 건너뛰었다. 색인은 했다" 라고 적혀 있었다 — 그때는 참이었고
      //    지금은 아니다. 색인도 하지 않는다(코덱스 11차 P1): replaceDocument 가
      //    같은 상대경로의 남의 행을 덮어쓰기 때문이다.
      console.log(chalk.red(
        '  🔴 이 DB 가 이 볼트의 것이라는 증거가 약해 <아무것도 하지 않았다>.'
        + ' STELLAVAULT_DB_PATH 로 이 볼트 전용 DB 를 지정하라.',
      ));
    }
    if (result.skippedFiles.length > 0) {
      const parts = Object.entries(reasonCount)
        .filter(([, c]) => c > 0)
        .map(([r, c]) => `${r}=${c}`)
        .join(', ');
      console.log(`  ⚠️  Skipped: ${result.skippedFiles.length} (${parts})`);
    }
    console.log(`  🧩 Chunks:  ${result.totalChunks} | ⏱ ${(result.elapsedMs / 1000).toFixed(1)}s`);
    console.log(`  💾 DB: ${dbPath}`);

    if (opts.logSkipped) {
      writeFileSync(
        opts.logSkipped,
        JSON.stringify({ skipped: result.skippedFiles, failed: result.failedFiles }, null, 2),
      );
      console.log(chalk.dim(`  📋 Skip log: ${opts.logSkipped}`));
    }

    // 🔴 자동화는 문구가 아니라 <종료 코드>를 본다 (코덱스 11차 P2). 아무것도 안 했는데
    //    0 으로 끝나면, 스크립트는 색인이 된 줄 알고 다음 단계로 넘어간다.
    if (didNothing) process.exit(1);
  } catch (err) {
    spinner.fail(chalk.red('Indexing failed'));
    const e = err as Error;
    console.error(chalk.red(`\n  ${e.message ?? err}`));
    if (e.stack) console.error(chalk.dim(e.stack.split('\n').slice(1, 5).join('\n')));
    if ((e.message ?? '').match(/heap|out of memory|allocation failed/i)) {
      console.error(chalk.yellow('\n  💡 Hint: large vault detected. Retry with a larger Node heap:'));
      console.error(chalk.yellow('     NODE_OPTIONS="--max-old-space-size=8192 --expose-gc" stellavault index <path>'));
    }
    try { await store.close(); } catch { /* ignore */ }
    process.exit(1);
  }
}
