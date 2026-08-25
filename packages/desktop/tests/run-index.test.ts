// 🔴 `runFullIndex` 를 <동작으로> 잰다 (코덱스 16차 P2).
//
// 이 함수는 렌더러의 <유일한 색인 입구>다. 그래서 여기서 판정을 놓치면 다섯 호출부가
// 전부 함께 눈이 먼다. 그런데 오랫동안 이 함수에는 시험이 하나도 없었고,
// 조건을 `!r.ok` 에서 옛 두 필드로 되돌리는 변이가 <살아남았다>.
//
// ⚠️ 렌더러 모듈이라 `window`·`document` 가 없다. 두 의존을 모듈째 바꿔 끼운다 —
//    재려는 것은 <판정>이지 토스트의 DOM 이 아니다.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls: Array<{ msg: string; kind: string }> = [];
let reply: Record<string, unknown> = {};

vi.mock('../src/renderer/lib/ipc-client.js', () => ({
  ipc: async () => reply,
  onIpc: () => () => {},
}));
vi.mock('../src/renderer/lib/toast.js', () => ({
  showToast: (msg: string, kind: string) => { calls.push({ msg, kind }); },
}));

const { runFullIndex } = await import('../src/renderer/lib/run-index.js');

/** main 의 `core:index` 응답 모양. 기본은 <성공>이고 시험마다 필요한 것만 뒤집는다. */
function res(over: Partial<Record<string, unknown>> = {}) {
  return {
    indexed: 3, totalChunks: 9, failed: 0,
    foreignDb: false, ownershipUnverified: false, note: '', ok: true,
    ...over,
  };
}

beforeEach(() => { calls.length = 0; reply = res(); });

describe('runFullIndex — <아무것도 이루지 못한> 실행은 통과시키지 않는다', () => {
  it('성공하면 수치를 그대로 돌려준다', async () => {
    await expect(runFullIndex()).resolves.toEqual({ indexed: 3, totalChunks: 9, failed: 0 });
    expect(calls).toEqual([]);
  });

  it('★ 남의 DB → 던진다', async () => {
    reply = res({ ok: false, foreignDb: true, indexed: 0, note: '🔴 남의 DB — 아무것도 안 했다' });
    await expect(runFullIndex()).rejects.toThrow('남의 DB');
    expect(calls[0]?.kind).toBe('error');
  });

  it('★ 소유 미확인 → 던진다', async () => {
    reply = res({ ok: false, ownershipUnverified: true, indexed: 0, note: '🔴 소유 미확인' });
    await expect(runFullIndex()).rejects.toThrow('소유 미확인');
  });

  it('★★ <전부 실패>도 던진다 — 두 필드만 보던 시절 이것이 성공으로 도착했다', async () => {
    // foreignDb·ownershipUnverified 는 <거짓>이다. 옛 조건은 이 경우를 통과시켰다.
    reply = res({ ok: false, indexed: 0, failed: 4, note: '❌ 실패 4 — 성공한 것이 하나도 없다' });
    await expect(runFullIndex()).rejects.toThrow('성공한 것이 하나도 없다');
  });

  it('★★ <엔진 미준비>도 던진다 — 같은 구멍의 다른 입구', async () => {
    reply = res({ ok: false, indexed: 0, note: '엔진이 아직 준비되지 않았다' });
    await expect(runFullIndex()).rejects.toThrow('엔진이 아직 준비되지 않았다');
  });

  it('★ 이룬 것이 있는데 실패가 섞이면 — 던지지 않고 <소리만> 낸다', async () => {
    reply = res({ ok: true, indexed: 2, failed: 1, note: '❌ 실패 1' });
    await expect(runFullIndex()).resolves.toEqual({ indexed: 2, totalChunks: 9, failed: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('error');
  });

  it('note 가 비면 조용하다 — 정상 실행마다 빨간 토스트가 뜨면 아무도 안 본다', async () => {
    reply = res({ note: '' });
    await runFullIndex();
    expect(calls).toEqual([]);
  });

  it('★ ok:false 인데 note 가 비어도 <말없이 성공하지> 않는다', async () => {
    reply = res({ ok: false, note: '' });
    await expect(runFullIndex()).rejects.toThrow();
  });
});
