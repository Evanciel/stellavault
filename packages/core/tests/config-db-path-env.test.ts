// 🔴 `STELLAVAULT_DB_PATH` 가 <모든 명령>에 통하는지 잰다 (2026-08-22).
//
// 왜 이 시험이 생겼나: 소유권 가드가 막을 때 이렇게 안내한다 —
//     "STELLAVAULT_DB_PATH=<다른경로.db> stellavault <명령>"
// 그런데 이 환경변수를 <`index` 명령 하나만> 읽고 있었다(`resolveDbPath`). 나머지는
// `loadConfig()` 를 쓰는데 거기서는 무시됐다. 즉 사용자가 <시킨 대로 해도 안 되는>
// 안내였다. ★막다른 길을 가리키는 오류 메시지는 없는 것보다 나쁘다.
//
// 실측으로 발견했다: 15개 명령에 가드를 붙인 뒤 이 변수로 남의 DB 를 가리켜 거부를
// 확인하려 했더니 <전부 통과>했다. 코드가 아니라 시험이 틀린 것이었지만, 그 실패가
// 이 결함을 드러냈다.
import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

const KEY = 'STELLAVAULT_DB_PATH';
const saved = process.env[KEY];
afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

describe('loadConfig 는 STELLAVAULT_DB_PATH 를 <이긴 값으로> 받는다', () => {
  it('★★ env 가 설정 파일의 dbPath 를 이긴다', () => {
    delete process.env[KEY];
    const withoutEnv = loadConfig().dbPath;

    process.env[KEY] = 'A:/전혀/다른/자리.db';
    expect(loadConfig().dbPath).toBe('A:/전혀/다른/자리.db');
    expect(loadConfig().dbPath).not.toBe(withoutEnv);
  });

  it('★ 공백만 든 값은 <설정이 아니다> — 빈 문자열로 DB 를 열면 안 된다', () => {
    delete process.env[KEY];
    const base = loadConfig().dbPath;
    process.env[KEY] = '   ';
    expect(loadConfig().dbPath).toBe(base);
  });

  it('★ 앞뒤 공백은 다듬는다 — 셸에서 흔히 딸려 온다', () => {
    process.env[KEY] = '  A:/여백/있음.db  ';
    expect(loadConfig().dbPath).toBe('A:/여백/있음.db');
  });

  it('★ env 가 없으면 아무것도 안 바꾼다', () => {
    delete process.env[KEY];
    const a = loadConfig().dbPath;
    expect(a).toBeTruthy();
    expect(a).not.toContain('전혀/다른');
  });

  it('★ 그래도 vaultPath 는 안 건드린다 — 이 변수는 DB 만 가리킨다', () => {
    delete process.env[KEY];
    const before = loadConfig().vaultPath;
    process.env[KEY] = 'A:/다른.db';
    expect(loadConfig().vaultPath).toBe(before);
  });
});
