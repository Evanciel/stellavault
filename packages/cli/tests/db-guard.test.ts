// 🔴 `refuseForeignDbEarly` 를 <동작으로> 잰다.
//
// 왜 필요한가: 이 문을 만들고 나서 CLI 쪽은 <소스 검사>로만 쟀다. 그랬더니
// 함수 본문을 `return;` 한 줄로 바꾸는 변이가 <살아남았다> — 호출은 그대로 있고
// `process.exit(1)` 도 파일에 그대로 남으니, 소스 검사는 전부 초록이었다.
// ★"부르고 있다" 와 "그것이 무언가를 한다" 는 다른 사실이다.
//
// ⚠️ 이 파일은 CLI <소스>를 직접 부른다(`../src/db-guard.js`). core 는 dist 로 풀리지만
//    그것은 여기서 <재는 대상이 아니다> — 재는 것은 CLI 의 판단이다.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSqliteVecStore, VAULT_OWNER_KEY } from '@stellavault/core';
import { refuseForeignDbEarly } from '../src/db-guard.js';

let dir: string;
let stamped: string;   // 어떤 볼트로 각인된 DB
let blank: string;     // 각인이 없는 DB
const OWNER = resolve('C:/어떤/다른/볼트');

beforeAll(async () => {
  dir = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'dbguard-'));

  stamped = join(dir, 'stamped.db');
  const a = createSqliteVecStore(stamped, 4);
  await a.initialize();
  a.setMeta(VAULT_OWNER_KEY, OWNER);
  await a.close();

  blank = join(dir, 'blank.db');
  const b = createSqliteVecStore(blank, 4);
  await b.initialize();
  await b.close();
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

/** `process.exit` 를 던지게 바꿔 잡는다 — 안 그러면 시험 프로세스가 죽는다. */
function catchExit(fn: () => void): number | 'no-exit' {
  const spy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error('EXIT:' + String(code));
  }) as never);
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    fn();
    return 'no-exit';
  } catch (err) {
    const m = /^EXIT:(\d+)$/.exec((err as Error).message);
    if (!m) throw err;
    return Number(m[1]);
  } finally {
    spy.mockRestore();
    quiet.mockRestore();
  }
}

describe('refuseForeignDbEarly — 남의 DB 면 <연다는 시늉도 하지 않는다>', () => {
  it('★ 각인이 어긋나면 exit 1', () => {
    expect(catchExit(() => refuseForeignDbEarly(stamped, join(dir, 'my-vault'), 'test'))).toBe(1);
  });

  it('★ 각인이 맞으면 통과한다 — 가드가 전부를 막지 않는다', () => {
    expect(catchExit(() => refuseForeignDbEarly(stamped, OWNER, 'test'))).toBe('no-exit');
  });

  it('★ 각인이 <없는> DB 는 통과한다 — 아니면 새 볼트가 영영 각인 못 한다', () => {
    expect(catchExit(() => refuseForeignDbEarly(blank, join(dir, 'my-vault'), 'test'))).toBe('no-exit');
  });

  it('★ DB 파일이 <아직 없으면> 통과한다 — 첫 실행이 그 모양이다', () => {
    expect(catchExit(() => refuseForeignDbEarly(join(dir, 'nope.db'), join(dir, 'v'), 'test'))).toBe('no-exit');
  });

  it('볼트 경로가 비면 물을 수 없다 → 통과', () => {
    expect(catchExit(() => refuseForeignDbEarly(stamped, '', 'test'))).toBe('no-exit');
  });

  it('★ 막을 때 <이유>를 남긴다 — 조용히 죽으면 사용자가 원인을 못 찾는다', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('EXIT'); }) as never);
    const quiet = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(' '));
    });
    try { refuseForeignDbEarly(stamped, join(dir, 'my-vault'), 'test'); } catch { /* 예상된 EXIT */ }
    finally { spy.mockRestore(); quiet.mockRestore(); }

    const all = lines.join('\n');
    expect(all).toContain(OWNER);            // 어느 볼트의 DB 인지
    expect(all).toContain('STELLAVAULT_DB_PATH');  // 어떻게 빠져나가는지
  });
});
