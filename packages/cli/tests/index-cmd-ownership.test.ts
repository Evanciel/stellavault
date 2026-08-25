// 🔴 CLI 가 <다른 볼트의 DB 를 지우지> 못하게 막는지 잰다.
//
// 2026-08-21 에 실제로 일어난 사고: 파일 2개짜리 스크래치 폴더를
// `stellavault index <그 폴더>` 로 색인했더니 `Deleted: 17376` —
// 실볼트 색인이 통째로 사라졌다. 원인은 DB 경로 결정 순서다
// (index-cmd.ts `resolveDbPath`: env > config.dbPath > 볼트해시).
// 볼트 인자를 바꿔도 <설정에 적힌 같은 DB> 에 붙는다.
//
// ★핵심: 이 시험은 <호출부>를 잰다. core 의 checkVaultOwnership 만 재면
//  CLI 가 그 함수를 안 부르도록 되돌려도 전부 초록이다 — 이 저장소가 오늘
//  이미 두 번 당한 함정이다(변이 T13 · E5).
//
// ⚠️ 이 패키지의 첫 시험이다. 그전까지 CLI 는 <한 줄도> 재지 않았다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSqliteVecStore, VAULT_OWNER_KEY, listVaults, removeVault } from '@stellavault/core';
import { createHash } from 'node:crypto';
import { indexCommand } from '../src/commands/index-cmd.js';

class ExitCalled extends Error {
  constructor(public code: number) { super(`process.exit(${code})`); }
}

let root: string;
let vaultA: string;
let vaultB: string;
let dbPath: string;
let realExit: typeof process.exit;
let prevDbEnv: string | undefined;

const mkVault = (name: string) => {
  const p = join(root, name);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'a.md'), '# ' + name + '\n\n본문이 있다.\n', 'utf-8');
  return p;
};

beforeEach(async () => {
  root = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'own-'));
  vaultA = mkVault('vaultA');
  vaultB = mkVault('vaultB');
  dbPath = join(root, 'a.db');

  // vaultA 의 DB 를 만들고, 문서 한 건을 넣고, 소유권을 각인한다.
  const store = createSqliteVecStore(dbPath);
  await store.initialize();
  store.setMeta(VAULT_OWNER_KEY, resolve(vaultA));
  await store.upsertDocument({
    id: 'a1', filePath: 'a.md', title: 'a', content: '지켜져야하는본문',
    frontmatter: {}, tags: [], lastModified: '2026-01-01', contentHash: 'h1',
  });
  await store.close();

  prevDbEnv = process.env.STELLAVAULT_DB_PATH;
  process.env.STELLAVAULT_DB_PATH = dbPath;
  realExit = process.exit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = (code?: number) => { throw new ExitCalled(code ?? 0); };
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = realExit;
  // 🔴 볼트 등록부는 <사용자의 진짜 홈>(~/.stellavault/vaults.json)에 있다.
  //    가드가 깨지면(또는 변이를 심으면) 임시 볼트가 거기 남는다 — 반드시 걷어낸다.
  for (const v of listVaults()) {
    if (v.path.startsWith(root)) removeVault(v.id);
  }
  if (prevDbEnv === undefined) delete process.env.STELLAVAULT_DB_PATH;
  else process.env.STELLAVAULT_DB_PATH = prevDbEnv;
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch (err) {
    console.warn(`[test] 임시 폴더 정리 실패(무해): ${root} — ${(err as Error).message}`);
  }
});

describe('stellavault index — DB 소유권', () => {
  it('★ 회귀: 다른 볼트를 인자로 주면 <색인을 시작하지 않고 exit 1>', async () => {
    await expect(indexCommand(vaultB, { noSpinner: true })).rejects.toThrow(/process\.exit\(1\)/);

    // 그리고 vaultA 의 문서가 <그대로 있다>. 이것이 사고에서 사라진 바로 그것이다.
    const store = createSqliteVecStore(dbPath);
    await store.initialize();
    expect((await store.getAllDocuments()).map(d => d.id)).toEqual(['a1']);
    expect(store.getMeta(VAULT_OWNER_KEY)).toBe(resolve(vaultA));   // 각인도 안 바뀐다
    await store.close();
  });

  it('★ 각인이 없는 DB 는 막지 않는다 — 첫 색인까지 못 하게 되면 안 된다', async () => {
    const fresh = join(root, 'fresh.db');
    process.env.STELLAVAULT_DB_PATH = fresh;
    const store = createSqliteVecStore(fresh);
    await store.initialize();
    expect(store.getMeta(VAULT_OWNER_KEY)).toBeUndefined();
    await store.close();

    // 임베더 로딩까지 가므로 오래 걸릴 수 있다 — 여기서는 <가드에 막히지 않는지>만 본다.
    // exit(1) 이 나면 실패다. 그 외 오류(모델 없음 등)는 이 시험의 관심사가 아니다.
    let exited: number | undefined;
    try { await indexCommand(vaultB, { noSpinner: true }); }
    catch (err) { if (err instanceof ExitCalled) exited = err.code; }
    expect(exited).toBeUndefined();

    // 🔴 "막히지 않았다" 만으로는 부족하다 — <각인이 실제로 써졌는지>까지 본다.
    //    setMeta 를 지워도 이 시험이 통과하면, 다음에 다른 볼트로 색인할 때
    //    첫 볼트가 지워진다 (코덱스 9차 P2).
    const after = createSqliteVecStore(fresh);
    await after.initialize();
    expect(after.getMeta(VAULT_OWNER_KEY)).toBe(resolve(vaultB));
    await after.close();
  }, 600_000);
});

// 🔴 코덱스 11차 P2 두 건. 둘 다 <아무것도 안 했는데 성공처럼 보이는> 부류다.
describe('stellavault index — 소유 미확인일 때의 출구', () => {
  // 파일 색인이 소유한 모양의 <남의 문서>를 만든다: id 는 상대경로 해시여야 한다.
  const fileOwned = (rel: string) => ({
    id: createHash('sha256').update(rel).digest('hex').slice(0, 16),
    filePath: rel, title: rel, content: '남의 본문', frontmatter: {}, tags: [],
    lastModified: '2026-01-01', contentHash: 'h-' + rel,
  });

  const seedForeign = async (dest: string) => {
    const store = createSqliteVecStore(dest);
    await store.initialize();
    for (let i = 0; i < 12; i++) await store.upsertDocument(fileOwned('theirs/n' + i + '.md'));
    expect(store.getMeta(VAULT_OWNER_KEY)).toBeUndefined();     // 각인은 <없다>
    await store.close();
  };

  it('★ 겹침이 약하면 <exit 1> 이고 볼트를 등록하지 않는다', async () => {
    // 🔴 볼트 <폴더 이름>이 곧 등록 id 다(소문자화). 고정 이름을 쓰면, 예전 실행이
    //    남긴 같은 id 때문에 addVault 가 던지고 CLI 가 그것을 <삼켜서> 등록이 안 된다
    //    — 그러면 "등록하지 않았다" 는 단언이 <가드가 아니라 우연>을 재게 된다.
    //    실측: 그 상태에서 변이(등록을 판정 전으로 되돌리기)가 살아남았다.
    const uniq = 'uv-' + Math.random().toString(36).slice(2, 10);
    const vaultU = mkVault(uniq);
    const foreign = join(root, 'foreign.db');
    process.env.STELLAVAULT_DB_PATH = foreign;
    await seedForeign(foreign);

    // 🔴 자동화는 문구가 아니라 <종료 코드>를 본다. 예전에는 초록 "Indexing complete"
    //    를 찍고 0 으로 끝나서, 스크립트가 색인이 된 줄 알고 다음 단계로 갔다.
    await expect(indexCommand(vaultU, { noSpinner: true })).rejects.toThrow(/process\.exit\(1\)/);

    // 🔴 그리고 <등록도 하지 않는다>. 예전에는 core 판정 <전에> 등록해서, 잘못된
    //    볼트·DB 짝이 영구 설정에 남았다 — 그 뒤로는 그것이 기본값처럼 쓰인다.
    expect(listVaults().some(v => v.path === vaultU)).toBe(false);

    // 남의 문서는 그대로다 — 미확인일 때 허용되는 쓰기는 <새 문서 삽입>뿐이다.
    const after = createSqliteVecStore(foreign);
    await after.initialize();
    const theirs = (await after.getAllDocuments()).filter(d => d.filePath.startsWith('theirs/'));
    expect(theirs.length).toBe(12);
    expect(after.getMeta(VAULT_OWNER_KEY)).toBeUndefined();     // 각인도 안 가져간다
    await after.close();
  }, 600_000);
});
