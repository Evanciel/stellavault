// 🔴 색인 1회 실행의 <보고>를 잰다. 코덱스 12차 P2 세 건이 전부 여기 모인다:
//   ① API 응답에 `failed` 가 없다 ② serve 감시자 로그에 `failed` 가 없고 문구가 낡았다
//   ③ 데스크톱 감시자는 반환값을 통째로 버린다.
//
// ★셋의 공통 원인은 <같은 판단을 세 곳에서 손으로 다시 쓴 것>이다. 판단을 한 곳에
//  모으고 그 한 곳을 잰다. 부르는 쪽은 타입이 강제한다.
import { describe, it, expect } from 'vitest';
import { summarizeIndexRun } from '../src/indexer/report.js';
import { reindexResponse } from '../src/api/server.js';
import type { IndexResult } from '../src/indexer/index.js';
import { runMaintenanceIfOwned, VAULT_OWNER_KEY } from '../src/store/vault-ownership.js';
import { resolve as resolvePath } from 'node:path';

const base: IndexResult = {
  indexed: 3, skipped: 1, deleted: 0, deferredDeletes: 0, failed: 0,
  totalChunks: 9, elapsedMs: 1, totalFiles: 4, skippedFiles: [], failedFiles: [],
};

describe('summarizeIndexRun — 아무것도 안 한 실행은 성공이 아니다', () => {
  it('평범한 성공은 ok 이고 꼬리말이 없다', () => {
    const s = summarizeIndexRun(base);
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('ok');
    expect(s.note).toBe('');
  });

  it('★ 남의 DB 는 ok 가 아니다', () => {
    const s = summarizeIndexRun({ ...base, foreignDb: true });
    expect(s.ok).toBe(false);
    expect(s.kind).toBe('foreign');
  });

  it('★ <소유 미확인>도 ok 가 아니다 — foreignDb 만 보던 시절의 구멍', () => {
    const s = summarizeIndexRun({ ...base, ownershipUnverified: true });
    expect(s.ok).toBe(false);
    expect(s.kind).toBe('unverified');
    // 🔴 문구가 구현보다 오래 살지 않게 못박는다. 한때 "삭제만 건너뜀" 이 찍혔고
    //    그것은 <이미 폐기된 규칙>이었다.
    expect(s.note).toContain('아무것도 안 했다');
    expect(s.note).not.toContain('삭제만');
  });

  it('★ 실패가 있어도 <성공이 하나라도 있으면> ok 다 — 부분 성공은 실재한다', () => {
    const s = summarizeIndexRun({ ...base, indexed: 3, failed: 7 });
    expect(s.ok).toBe(true);
    expect(s.note).toContain('7');
  });

  it('★ 전부 실패한 실행은 ok 가 <아니다> (코덱스 13차 P2)', () => {
    // 한때 "실패는 ok 를 뒤집지 않는다" 로 두었더니 `indexed=0 · failed=1000` 이
    // success: true 로 나갔다. 부분 성공이 실재한다는 것은 참이지만, 그 문장이
    // <성공이 0인 경우>까지 덮은 것이 틀렸다.
    const s = summarizeIndexRun({ ...base, indexed: 0, skipped: 0, deleted: 0, failed: 1000 });
    expect(s.ok).toBe(false);
    expect(s.kind).toBe('allFailed');
    expect(s.note).toContain('1000');
  });

  it('★ 삭제만 성공해도 ok 다 — indexed 만 보면 삭제 전용 실행이 실패로 찍힌다', () => {
    const s = summarizeIndexRun({ ...base, indexed: 0, deleted: 4, failed: 1 });
    expect(s.ok).toBe(true);
  });

  it('실패가 0 이면 indexed 가 0 이어도 ok 다 (전부 unchanged 인 평범한 실행)', () => {
    expect(summarizeIndexRun({ ...base, indexed: 0, skipped: 40, failed: 0 }).ok).toBe(true);
  });

  it('미룬 삭제도 보인다', () => {
    expect(summarizeIndexRun({ ...base, deferredDeletes: 2 }).note).toContain('2');
  });

  it('실패와 미룬 삭제가 함께면 <둘 다> 보인다 — 하나가 다른 하나를 가리지 않는다', () => {
    const note = summarizeIndexRun({ ...base, failed: 5, deferredDeletes: 3 }).note;
    expect(note).toContain('5');
    expect(note).toContain('3');
  });
});

describe('reindexResponse — POST /api/reindex 응답', () => {
  it('★ 실패 수를 담는다 — 없으면 "999개 실패" 도 success 로 읽힌다', () => {
    const r = reindexResponse({ ...base, failed: 999 });
    expect(r.failed).toBe(999);
  });

  it('★ 소유 미확인은 success 가 아니다', () => {
    expect(reindexResponse({ ...base, ownershipUnverified: true }).success).toBe(false);
    expect(reindexResponse({ ...base, ownershipUnverified: true }).ownershipUnverified).toBe(true);
  });

  it('★ 남의 DB 도 success 가 아니다', () => {
    expect(reindexResponse({ ...base, foreignDb: true }).success).toBe(false);
  });

  it('평범한 실행은 success 다 — 가드가 전부를 막지 않는다', () => {
    const r = reindexResponse(base);
    expect(r.success).toBe(true);
    expect(r.indexed).toBe(3);
    expect(r.chunks).toBe(9);
  });
});

describe('runMaintenanceIfOwned — 소유가 확정된 DB 에서만 돈다 (코덱스 13차 P2)', () => {
  const fake = (owner: string | undefined) => {
    let ran = 0;
    return {
      store: {
        getMeta: (k: string) => (k === VAULT_OWNER_KEY ? owner : undefined),
        runMaintenanceOnce: () => { ran++; },
      },
      ran: () => ran,
    };
  };
  const HERE = resolvePath('/tmp/vault-x');

  it('★ 각인이 이 볼트면 돈다 — 읽기 전용 경로도 이관을 받는다', () => {
    const f = fake(HERE);
    expect(runMaintenanceIfOwned(f.store, HERE)).toBe(true);
    expect(f.ran()).toBe(1);
  });

  it('★ 각인이 <없으면> 돌지 않는다 — 모르면 안 만진다', () => {
    const f = fake(undefined);
    expect(runMaintenanceIfOwned(f.store, HERE)).toBe(false);
    expect(f.ran()).toBe(0);
  });

  it('★ 각인이 <다른 볼트>면 돌지 않는다', () => {
    const f = fake(resolvePath('/tmp/somewhere-else'));
    expect(runMaintenanceIfOwned(f.store, HERE)).toBe(false);
    expect(f.ran()).toBe(0);
  });

  it('★ 볼트 경로가 비면 돌지 않는다 — 설정이 없는 상태를 각인 대조로 착각하지 않는다', () => {
    // 🔴 소유자를 <resolve('') 와 같게> 둔다. 안 그러면 빈 경로 가드를 지워도
    //    mismatch 가 대신 막아 <변이가 살아남는다>(실측: 이 시험이 처음에 그랬다).
    //    resolve('') 는 cwd 다 — 설정이 비었을 때 그것을 볼트로 오인하는 것이 이 결함이다.
    const f = fake(resolvePath(''));
    expect(runMaintenanceIfOwned(f.store, '')).toBe(false);
    expect(f.ran()).toBe(0);
  });
});
