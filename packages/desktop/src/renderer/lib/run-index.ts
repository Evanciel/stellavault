// 전체 색인 1회분을 돌리고, <아무것도 안 했으면 소리를 낸다>.
//
// 🔴 왜 필요한가 (코덱스 15차 P2):
//    main 이 `foreignDb`·`ownershipUnverified`·`note` 를 돌려주게 만들어 놓고
//    (14차 P2), 정작 렌더러 <다섯 곳>이 그 값을 한 번도 안 봤다. 그래서 남의 DB 에서
//    색인이 거부돼도 화면에는 "0개 색인" 으로만 보였다 — <빈 볼트와 구별이 안 된다>.
//    ★필드를 늘리는 것과 그 필드가 쓰이는 것은 다른 일이다. 이 저장소가 계속 잡는 부류다.
//
// ⚠️ 던진다. 호출부 대부분이 이미 try/catch 로 감싸 로그를 남기고 있어서, 던지면
//    <아무것도 안 고쳐도> 그 경로들이 자동으로 실패를 보게 된다. 토스트는 여기서 띄운다 —
//    다섯 곳에 각각 띄우게 하면 다섯 번째가 빠진다.

import { ipc } from './ipc-client.js';
import { showToast } from './toast.js';

export interface FullIndexResult {
  indexed: number;
  totalChunks: number;
  failed: number;
}

/**
 * @throws 색인이 <아무것도 이루지 못했을> 때. 거부(남의 DB·소유 미확인)·전부 실패·
 *         엔진 미준비가 전부 여기 든다.
 *
 * 🔴 한때 이 문장이 "성공한 것이 하나도 없을 때" 라고 <약속만> 했다 (코덱스 16차 P2).
 *    구현은 `foreignDb`·`ownershipUnverified` 두 개만 봤고, `allFailed` 와
 *    엔진 미준비는 <성공으로 반환>됐다. 판정할 정보(`ok`)가 응답에 없었기 때문이다 —
 *    main 은 그것을 계산해 놓고 버리고 있었다. 이제 실어 보내고, 여기서 그것을 본다.
 *    ★약속을 지킬 <정보가 없는> 주석은 거짓말과 구별되지 않는다.
 */
export async function runFullIndex(): Promise<FullIndexResult> {
  const r = await ipc('core:index');
  if (!r.ok) {
    const msg = r.note || '색인이 아무것도 이루지 못했다';
    showToast(msg, 'error', 8000);
    throw new Error(msg);
  }
  // 이룬 것은 있지만 실패가 섞였으면 <조용히 넘기지 않는다>.
  if (r.note) showToast(r.note, 'error', 6000);
  return { indexed: r.indexed, totalChunks: r.totalChunks, failed: r.failed };
}
