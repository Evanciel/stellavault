// 🔴 <내가 실제로 낸 사고>를 막는 게이트 (2026-08-21).
//
// 파일 2개짜리 스크래치 폴더를 `stellavault index <그 폴더>` 로 색인했더니
// `Deleted: 17376` — 실볼트의 색인이 통째로 사라졌다. CLI 가 DB 경로를
// `config.dbPath` 우선으로 잡아, 볼트 인자를 바꿔도 <같은 DB> 에 붙었기 때문이다.
//
// ★이 세션이 종일 고친 <삭제 가드>로는 못 막는다 — 그 삭제는 규칙상 올바른 동작이다.
//  실패도 없었고 못 읽은 파일도 없었다. 그러니 막을 자리는 삭제가 아니라 <짝짓기>다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkVaultOwnership, overlapIsConvincing, VAULT_OWNER_KEY } from '../src/store/vault-ownership.js';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import type { VectorStore } from '../src/store/types.js';

describe('checkVaultOwnership', () => {
  it('★ 처음 보는 DB 는 각인 대상이다', () => {
    expect(checkVaultOwnership(undefined, '/v/a')).toEqual({ kind: 'claim', vaultPath: '/v/a' });
    expect(checkVaultOwnership('', '/v/a')).toEqual({ kind: 'claim', vaultPath: '/v/a' });
  });

  it('★ 같은 볼트면 통과한다', () => {
    expect(checkVaultOwnership('/v/a', '/v/a')).toEqual({ kind: 'ok' });
  });

  it('★ 회귀: 다른 볼트면 <막는다> — 이것이 17,376건을 지운 그 자리다', () => {
    expect(checkVaultOwnership('F:/Obsidian/Evan', 'A:/scratch/tiny'))
      .toEqual({ kind: 'mismatch', owner: 'F:/Obsidian/Evan', here: 'A:/scratch/tiny' });
  });

  it('★ 하위 폴더는 <같은 볼트가 아니다>', () => {
    // 볼트의 하위 폴더를 인자로 주면 나머지가 전부 "디스크에 없다"가 된다.
    // startsWith 로 통과시키는 변이를 막는다.
    expect(checkVaultOwnership('/v/a', '/v/a/sub').kind).toBe('mismatch');
  });

  it('★ 대소문자만 달라도 막는다 — 뭉개는 규칙이 틀리면 볼트를 잃는다', () => {
    expect(checkVaultOwnership('/v/A', '/v/a').kind).toBe('mismatch');
  });
});

describe('스토어 meta 왕복', () => {
  let dir: string;
  let store: VectorStore;
  beforeEach(async () => {
    dir = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'meta-'));
    store = createSqliteVecStore(join(dir, 'x.db'), 4);
    await store.initialize();
  });
  afterEach(async () => {
    await store.close();
    // 🔴 뒷정리 실패를 <시험 실패로 만들지 않는다>. 윈도우는 close 직후에도 SQLite
    //    파일 핸들을 잠깐 붙잡아 EBUSY 를 낸다(실측). 그것은 이 시험이 재는 대상이
    //    아니며, 실패로 만들면 <진짜 빨강을 가리는 잡음>이 된다. 대신 조용히 넘기지
    //    않고 남긴다 — 임시 폴더가 쌓이면 그 자국으로 알 수 있어야 한다.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch (err) {
      console.warn(`[test] 임시 폴더 정리 실패(무해): ${dir} — ${(err as Error).message}`);
    }
  });

  it('★ 각인이 <다음 실행에서도> 읽힌다 — 안 그러면 매번 claim 이라 가드가 무력해진다', async () => {
    expect(store.getMeta(VAULT_OWNER_KEY)).toBeUndefined();
    store.setMeta(VAULT_OWNER_KEY, 'F:/Obsidian/Evan');
    expect(store.getMeta(VAULT_OWNER_KEY)).toBe('F:/Obsidian/Evan');

    const dbFile = join(dir, 'x.db');
    await store.close();
    const again = createSqliteVecStore(dbFile, 4);
    await again.initialize();
    expect(again.getMeta(VAULT_OWNER_KEY)).toBe('F:/Obsidian/Evan');
    // afterEach 가 close 할 수 있도록 되돌린다.
    store = again;
  });

  it('★ initialize 가 각인을 지우지 않는다', async () => {
    store.setMeta(VAULT_OWNER_KEY, '/v/a');
    await store.initialize();                 // 재실행해도 스키마만 보장한다
    expect(store.getMeta(VAULT_OWNER_KEY)).toBe('/v/a');
  });
});

// 🔴 판정식을 <직접> 겨눈다. indexVault 를 통해서만 재면 픽스처가 작아서
//    "작은 쪽 기준 비율" 같은 틀린 식도 통과한다 — 실제로 처음에 그렇게 짰다.
describe('overlapIsConvincing', () => {
  it('빈 DB 는 누구든 가져갈 수 있다', () => {
    expect(overlapIsConvincing(0, 0, 100)).toBe(true);
  });

  it('★ 스캔이 비면 <가져가지 않는다> (마운트 실패 모양)', () => {
    expect(overlapIsConvincing(0, 17376, 0)).toBe(false);
  });

  it('★ 회귀: 사고 모양 — DB 17,376 · 스캔 2 · 겹침 1', () => {
    expect(overlapIsConvincing(1, 17376, 2)).toBe(false);
  });

  it('★ 회귀: 스캔 두 개가 <둘 다> 겹쳐도 안 된다 (작은 쪽 기준 100%)', () => {
    // 이 줄이 없으면 min 기준 비율식이 통과한다.
    expect(overlapIsConvincing(2, 17376, 2)).toBe(false);
  });

  it('★ 회귀: 첫 실행이 넣은 뒤의 두 번째 실행 — DB 11 · 스캔 1 · 겹침 1', () => {
    expect(overlapIsConvincing(1, 11, 1)).toBe(false);
  });

  it('평범한 업그레이드는 통과한다 (겹침이 DB 전체)', () => {
    expect(overlapIsConvincing(17376, 17376, 17400)).toBe(true);
  });

  it('볼트가 크게 <줄어도> 통과한다 — 절대 하한을 넘으면', () => {
    // DB 기준으로는 40% 뿐이라 ①은 못 넘고, ②(스캔 90% + 50건)로 구제된다.
    expect(overlapIsConvincing(6950, 17376, 6950)).toBe(true);
  });

  it('볼트가 크게 <늘어도> 통과한다', () => {
    expect(overlapIsConvincing(17376, 17376, 26000)).toBe(true);
  });

  it('★ 절대 하한 아래면 스캔 기준 100% 라도 안 된다', () => {
    expect(overlapIsConvincing(49, 5000, 49)).toBe(false);
    expect(overlapIsConvincing(50, 5000, 50)).toBe(true);
  });

  it('작은 볼트는 DB 기준 절반으로 통과한다', () => {
    expect(overlapIsConvincing(3, 3, 3)).toBe(true);
    expect(overlapIsConvincing(2, 3, 2)).toBe(true);
  });
});

// 🔴🔴 이 describe 는 <한 번 틀렸었다>. 기록을 남긴다 — 지우면 왜 이 순서인지가 사라진다.
//
//   11차 지적: "빈 스캔(scanned === 0)을 <먼저> 거부하라. 안 그러면 마운트가 안 된 상태에서
//   빈 DB 를 각인하고, 다음 실행이 ok 가 되어 진짜 볼트를 가리키면 전부 지운다."
//   그대로 순서를 뒤집고 `(0, 0, 0) === false` 를 여기 못박았다.
//
//   → 12차가 그것을 <회귀>로 잡았다: 새 볼트를 새 DB 로 초기화하는 정상 경로가
//     정확히 (0, 0, 0) 이다(빈 폴더 + 빈 DB). 그 볼트는 <영영> 각인하지 못한다.
//
//   ★두 지적이 같은 지점을 반대로 말한 이유는 <잃을 것>을 안 봤기 때문이다.
//    파일 문서가 0 개인 DB 는 잘못 각인해도 잃을 것이 없고, 틀렸으면 다음 실행이
//    mismatch 로 막는다. 11차가 그린 사고는 <DB 에 문서가 있을 때>만 성립한다.
describe('빈 DB 와 빈 스캔 — 어느 쪽을 먼저 보는가', () => {
  it('★ (0, 0, 0) 은 통과한다 — 새 볼트를 새 DB 로 여는 정상 경로다', () => {
    expect(overlapIsConvincing(0, 0, 0)).toBe(true);
  });
  it('빈 DB + 실제 스캔도 통과한다 (첫 색인)', () => {
    expect(overlapIsConvincing(0, 0, 12)).toBe(true);
  });
  it('★ 11차가 그린 사고는 <문서가 있을 때>만 성립하고, 거기서는 여전히 막힌다', () => {
    // 마운트 실패 = 스캔 0. DB 에는 17,376개가 들어 있다.
    expect(overlapIsConvincing(0, 17376, 0)).toBe(false);
    // 문서가 하나만 있어도 막는다 — 물을 수 없으면 가져가지 않는다.
    expect(overlapIsConvincing(0, 1, 0)).toBe(false);
  });
});
