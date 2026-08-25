// 🔴 CLI 두 명령의 <쓰기 순서>를 잰다 (코덱스 13차 P1 #5 · P2 #10).
//
// ⚠️ 이 파일이 재는 것을 정직하게 적는다: <소스의 순서>이지 제어 흐름이 아니다.
//    행동으로 재지 못하는 이유가 있다 —
//      · `initCommand()` 는 stdin 을 읽고, 실제 임베딩 모델(~30MB)을 내려받고,
//        <사용자의 진짜 홈>인 `~/.stellavault.json` 에 쓴다. 시험이 그것을 덮으면
//        사용자의 설정이 날아간다. 인자로 우회할 입구도 없다.
//      · `packImportCommand()` 도 같은 실제 모델을 쓴다.
//    ★그래서 이것은 <약한 시험>이다. 순서를 뒤집는 회귀는 잡지만, 조건이 뒤집히는
//     회귀(예: `if (!result.foreignDb)`)는 못 잡는다. 그 한계를 적어 두는 것이
//     "초록이니 안전하다" 로 읽히지 않게 하는 유일한 방법이다.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands');
const read = (f: string) => readFileSync(join(SRC, f), 'utf-8');
/** `src/` 바로 아래 파일 (공용 문 등). */
const read2 = (f: string) => readFileSync(join(SRC, '..', f), 'utf-8');
/**
 * 줄 주석을 지운다. <순서>를 재는 검사는 주석 속 코드 인용에 걸리면 안 된다.
 * ⚠️ 문자열 안의 `//`(URL 등)도 함께 지워지지만, 이 검사들은 그 자리를 안 본다.
 */
const stripComments = (src: string) => src.replace(/^[ 	]*\/\/.*$/gm, '');

describe('init — 소유가 거부되면 <설정도 남기지 않는다>', () => {
  const s = read('init-cmd.ts');

  it('★ 설정 파일 쓰기는 소유권 거부 <뒤에> 있다', () => {
    const reject = s.indexOf('if (result.foreignDb || result.ownershipUnverified) {');
    const write = s.indexOf("writeFileSync(join(homedir(), '.stellavault.json')");
    expect(reject).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    // 거부 분기가 <먼저> 나와야 한다. 예전에는 반대였고, 거부되어 exit 1 로 끝나도
    // 잘못된 볼트/DB 짝이 영구히 남았다.
    expect(write).toBeGreaterThan(reject);
  });

  it('★ 그 쓰기는 <한 곳> 뿐이다 — 앞쪽에 하나 더 두면 위 검사가 무의미해진다', () => {
    const hits = s.split("writeFileSync(join(homedir(), '.stellavault.json')").length - 1;
    expect(hits).toBe(1);
  });

  it('거부 분기는 실제로 <종료>한다 — 표시만 찍고 진행하면 아래 쓰기에 닿는다', () => {
    const reject = s.indexOf('if (result.foreignDb || result.ownershipUnverified) {');
    const write = s.indexOf("writeFileSync(join(homedir(), '.stellavault.json')");
    expect(s.slice(reject, write)).toContain('process.exit(1)');
  });
});

// 🟢 pack 쪽은 <동작으로> 잰다 — 판정을 순수 함수로 뽑았기 때문이다.
//    처음엔 여기도 소스 순서로 쟀는데 `if (wroteNothing)` → `if (false)` 변이가
//    <살아남았다>. 순서 검사는 조건이 뒤집히는 회귀를 못 잡는다(위 주석의 그 한계다).
//    → 핵심 판정을 `packImportSucceeded` 로 옮기고 그것을 잰다.
// 🟢 <판정 자체>는 core 에서 동작으로 잰다 (`pack.test.ts`).
//    여기서는 CLI 가 그 판정을 실제로 배선했는지만 본다.
//    ⚠️ 이것도 소스 검사다 — 그래서 "process.exit 이 있나" 가 아니라
//    <조건 표현식까지> 못박는다. 전자는 `if (false)` 변이가 그대로 통과했다.
describe('pack import — CLI 가 성공 판정을 <실제로 배선했다>', () => {
  const s = read('pack-cmd.ts');

  it('★ 판정 함수를 쓴다 — 조건을 여기서 다시 손으로 쓰면 두 곳이 갈린다', () => {
    expect(s).toContain('const wroteNothing = !packImportSucceeded(result);');
  });

  it('★ 그 값이 <조건으로> 쓰인다 — 상수로 바뀌면 판정이 죽는다', () => {
    expect(s).toContain('if (wroteNothing) {');
  });

  it('★ 그 분기가 종료 코드로 이어진다', () => {
    const guard = s.indexOf('if (wroteNothing) {');
    expect(guard).toBeGreaterThan(-1);
    expect(s.slice(guard, guard + 400)).toContain('process.exit(1)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 코덱스 14차 — <열기 전에 묻는다> · <쓰기 전에 묻는다> · <판정 뒤에 초록>
// ═══════════════════════════════════════════════════════════════════════════

// 🔴 14차에는 이 검사가 index-cmd 안에 <인라인>으로 있었고 시험도 그 글자를 쟀다.
//    15차에 공용 문(`db-guard.ts`)으로 옮겼다 — 다섯 명령이 같은 문을 써야 하기 때문이다.
//    그래서 시험도 <문 자체>를 재는 쪽으로 옮긴다. 아래 "모든 명령" describe 가 그것이다.
describe('index — DB 를 <열기 전에> 각인을 묻는다 (14차 P1 → 15차에 공용화)', () => {
  const s = read('index-cmd.ts');

  it('★ 그 문이 `createSqliteVecStore` 보다 <앞>에 있다 — 여는 순간 WAL·스키마가 닿는다', () => {
    const guard = s.indexOf('refuseForeignDbEarly(');
    const open = s.indexOf('createSqliteVecStore(dbPath)');
    expect(guard).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(open);
  });

  it('★ 각인이 <없는> DB 는 통과시킨다 — 아니면 새 볼트가 영영 각인 못 한다', () => {
    // 조건은 공용 문 안에 있다. 그 문이 무엇을 통과시키는지는 거기서 잰다.
    expect(read2('db-guard.ts')).toContain("peeked === undefined || peeked === ''");
  });

  it('★ 그 문이 실제로 <종료>한다 — 표시만 찍고 진행하면 아무것도 못 막는다', () => {
    expect(read2('db-guard.ts')).toContain('process.exit(1)');
  });
});

describe('pack import — 남의 DB 에는 쓰지 않는다 (14차 P1)', () => {
  const s = read('pack-cmd.ts');

  it('★ 소유 판정이 `importPack` 보다 <앞>에 있다', () => {
    const check = s.indexOf('const packOwnership = checkVaultOwnership(');
    const write = s.indexOf('await importPack(hub.store, hub.embedder, absPath)');
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(check).toBeLessThan(write);
  });

  // 🔴 14차에는 "어긋남에서만 멈춘다" 였다. 15차에 <각인 없음>까지 막도록 좁혔다 —
  //    팩 경로는 겹침을 물을 수단이 없어 규칙 2 를 스스로 만족시킬 수 없기 때문이다.
  //    그 판정은 아래 15차 describe 에서 잰다.
});

describe('serve — 색인이 아무것도 안 했으면 캐시도 건드리지 않는다 (14차 P1)', () => {
  const s = read('serve-cmd.ts');

  it('★ `invalidateGapCache` 가 `summary.ok` 안에 있다', () => {
    const guard = s.indexOf('if (summary.ok) {');
    const call = s.indexOf('invalidateGapCache(hub.store.getDb()');
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(guard);
    // 가드와 호출 사이에 블록이 닫히면 안 된다 — 같은 블록 안이어야 한다.
    expect(s.slice(guard, call)).not.toContain('\n              }');
  });
});

describe('init — 초록 완료 표시는 <판정 뒤>다 (14차 P2)', () => {
  const s = read('init-cmd.ts');

  it('★ `spinner.succeed` 가 소유권 거부 분기보다 <뒤>에 있다', () => {
    const reject = s.indexOf('if (result.foreignDb || result.ownershipUnverified) {');
    const ok = s.indexOf('spinner.succeed(chalk.green(doneLine))');
    expect(reject).toBeGreaterThan(-1);
    expect(ok).toBeGreaterThan(-1);
    expect(ok).toBeGreaterThan(reject);
  });

  it('★ 초록 완료 표시는 <한 곳>뿐이다 — 앞쪽에 하나 더 두면 위 검사가 무의미해진다', () => {
    expect(s.split('spinner.succeed(').length - 1).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 코덱스 15차 — <다섯 문 전부> 잠갔는가 · pack 은 각인된 DB 에만 쓰는가
// ═══════════════════════════════════════════════════════════════════════════

describe('DB 를 여는 <모든 명령>이 먼저 묻는다 (15차 P1 · 16차 P1 재작성)', () => {
  // 🔴🔴 이 시험은 <스스로 실패할 수 없었다> (코덱스 16차 P1).
  //
  //   두 겹으로 눈이 멀어 있었다:
  //   ① `OPENS_DB` 가 <손으로 쓴 다섯 개>였다. 나머지 명령은 애초에 안 봤다.
  //   ② 본다 해도 `chunks.filter(c => c.includes('refuseForeignDbEarly('))` 가
  //      <가드가 이미 있는 함수만> 남겼다. 가드가 <없는> 함수는 필터에서 빠져
  //      검사 대상이 아니게 된다 — 즉 "빠진 것" 이 정확히 안 보이는 모양이었다.
  //
  //   실측(2026-08-22): DB 를 여는 함수 <20개 중 15개>에 가드가 없었다.
  //   그런데 이 시험은 <초록이었다>. 다섯 개만 보고, 그 다섯은 통과했으니까.
  //
  //   ★같은 실수를 두 층에서 했다: 코드에서 "같은 검사를 손으로 다섯 번 쓰면 여섯 번째가
  //    빠진다" 고 <주석에 적어 놓고>, 그 주석을 지키라고 만든 <시험도 손으로 다섯 개>를 적었다.
  //   → 그래서 목록을 지운다. 파일을 훑어 <DB 를 여는 함수를 전부 찾아> 검사한다.
  const CMD_DIR = SRC;

  /** `export async function` 단위로 쪼개, 각 함수의 이름과 <주석 없는> 본문을 준다. */
  function commandFunctions(file: string): Array<{ name: string; body: string }> {
    // 🔴 주석을 먼저 지운다. 이 파일들은 주석에 `store.initialize()` 같은 <코드 조각>을
    //    인용하고, 그것이 실제 호출보다 위에 있어 순서 판정을 뒤집는다(실제로 겪었다).
    const src = stripComments(readFileSync(join(CMD_DIR, file), 'utf-8'));
    const out: Array<{ name: string; body: string }> = [];
    const parts = src.split('export async function ');
    for (const p of parts.slice(1)) {
      const name = /^(\w+)/.exec(p)?.[1] ?? '(익명)';
      out.push({ name, body: p });
    }
    return out;
  }

  /** 이 함수가 store 를 여는가. embedder.initialize() 는 DB 가 아니다. */
  function opensDb(body: string): boolean {
    return /(?<!embedder)\.initialize\(\)/.test(body.replace(/embedder\.initialize\(\)/g, ''));
  }

  const ALL = readdirSync(CMD_DIR).filter(f => f.endsWith('.ts')).sort();

  it('★ 훑을 명령 파일이 실제로 있다 — 0개면 이 시험 전체가 <공회전>이다', () => {
    expect(ALL.length).toBeGreaterThan(10);
  });

  it('★★ DB 를 여는 <모든> 함수가 refuseForeignDbEarly 를 부른다', () => {
    const missing: string[] = [];
    let opened = 0;
    for (const f of ALL) {
      for (const { name, body } of commandFunctions(f)) {
        if (!opensDb(body)) continue;
        opened++;
        if (!body.includes('refuseForeignDbEarly(')) missing.push(`${f}:${name}`);
      }
    }
    // 🔴 <세었는지>부터 잰다. 정규식이 틀려 0개를 세면 아래 expect 는 무조건 통과한다.
    expect(opened, 'DB 를 여는 함수를 하나도 못 찾았다 — 탐지기가 고장난 것이다').toBeGreaterThan(10);
    expect(missing, `가드 없이 DB 를 연다: ${missing.join(', ')}`).toEqual([]);
  });

  it('★★ 그 호출이 같은 함수 안에서 initialize() 보다 <앞>이다', () => {
    const late: string[] = [];
    let checked = 0;
    for (const f of ALL) {
      for (const { name, body } of commandFunctions(f)) {
        if (!opensDb(body)) continue;
        const guard = body.indexOf('refuseForeignDbEarly(');
        const open = body.replace(/embedder\.initialize\(\)/g, '').indexOf('.initialize()');
        if (guard === -1 || open === -1) continue;
        checked++;
        if (guard > open) late.push(`${f}:${name}`);
      }
    }
    expect(checked, '순서를 잰 함수가 하나도 없다').toBeGreaterThan(10);
    expect(late, `가드가 initialize() 보다 뒤에 있다: ${late.join(', ')}`).toEqual([]);
  });
});

describe('pack import 는 <각인이 확정된> DB 에만 쓴다 (15차 P1)', () => {
  const s = read('pack-cmd.ts');

  it("★ mismatch 만이 아니라 'ok 가 아니면' 막는다 — 각인 없는 DB 도 포함", () => {
    expect(s).toContain("packOwnership.kind !== 'ok'");
    // 옛 조건이 남아 있으면 두 판정이 갈린다.
    expect(s).not.toContain("config.vaultPath && packOwnership.kind === 'mismatch'");
  });

  // 🔴🔴 그 조건이 <무엇으로 시작하는지>가 중요하다 (코덱스 16차 P1).
  //    한때 `if (config.vaultPath && packOwnership.kind !== 'ok')` 였다. 볼트 경로가
  //    <비면> 조건 전체가 거짓이 되어 `mismatch` 든 `claim` 이든 그대로 통과했다 —
  //    즉 규칙 7 이 <판정할 수 없는 바로 그 경우에만> 면제됐다.
  //    조기 가드도 빈 경로에서는 통과하므로(물어볼 짝이 없다) 이곳이 마지막 문이다.
  //    ★"판정에 필요한 값이 없다" 는 통과 사유가 아니다.
  it("★★ 볼트 경로가 <비어도> 막는다 — 그 자리에 `config.vaultPath &&` 를 두지 마라", () => {
    expect(s, '빈 볼트 경로에서 조건 전체가 단락된다').not.toMatch(
      /if \(config\.vaultPath && packOwnership\.kind !== 'ok'\)/);
    // 조건은 소유 판정 <하나만> 본다.
    expect(s).toMatch(/if \(packOwnership\.kind !== 'ok'\)/);
  });

  it('★ 그때 이유가 <경로를 모른다>고 말한다 — "각인 없음" 으로 뭉개면 원인을 못 찾는다', () => {
    const i = s.indexOf("if (packOwnership.kind !== 'ok')");
    expect(s.slice(i, i + 700)).toContain('지금 볼트 경로를 모른다');
  });

  it('★ 그 분기가 종료로 이어진다', () => {
    const guard = s.indexOf("packOwnership.kind !== 'ok'");
    expect(s.slice(guard, guard + 800)).toContain('process.exit(1)');
  });
});
