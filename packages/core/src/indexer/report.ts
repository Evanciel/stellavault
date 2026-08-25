// 색인 1회 실행을 <한 줄로> 요약한다.
//
// 🔴 왜 따로 두는가: 같은 판단을 부르는 쪽마다 손으로 다시 썼고, 그때마다 조금씩
//    달라졌다 (코덱스 12차 P2). 실측 — 세 곳이 전부 `failed` 를 빠뜨렸고, 그중 한
//    곳(serve 감시자)은 "소유 미확인 → 삭제만 건너뜀" 이라는 <이미 폐기된 규칙>을
//    사용자에게 계속 보여주고 있었다. 판단을 한 곳에 두면 문구가 같이 늙지 않는다.

import type { IndexResult } from './index.js';
import type { SkippedFile } from './scanner.js';

/**
 * <다음에는 읽힐 수도 있는> 스캔 실패. 이것이 있으면 삭제를 미룬다.
 *
 * 🔴 `empty` 와 `too-large` 는 <파일의 안정적인 성질>이라 여기 넣지 않는다.
 *    넣으면 6MB 노트 하나가 볼트 전체의 삭제를 <영구히> 막는다 —
 *    실볼트에도 empty 가 상시 3건 있어, 넣는 순간 삭제가 한 번도 안 일어난다
 *    (코덱스 7차 P1 을 고치면서 같은 라운드의 P2 를 만들지 않으려는 선이다).
 *
 * 🔴 이 집합이 <indexer/index.ts 에서 여기로 옮겨 왔다> (코덱스 14차 P2).
 *    요약과 삭제 연기가 <같은 정의>를 봐야 하기 때문이다 — 갈리면 "삭제는 미뤘는데
 *    보고는 성공" 같은 조합이 나온다.
 */
const TRANSIENT_SKIPS: ReadonlySet<string> = new Set(['unreadable', 'parse-error', 'binary']);

/** 이번 실행이 <읽지 못한 것 때문에> 불완전한가. 불완전하면 삭제하지 않는다. */
export function sawUnreadable(skipped: readonly SkippedFile[]): boolean {
  return skipped.some(s => TRANSIENT_SKIPS.has(s.reason));
}

/** 못 읽은 파일 수. 요약 문구에 쓴다 — 있음/없음만으로는 규모가 안 보인다. */
export function countUnreadable(skipped: readonly SkippedFile[]): number {
  return skipped.reduce((n, s) => (TRANSIENT_SKIPS.has(s.reason) ? n + 1 : n), 0);
}

export type IndexRunKind = 'ok' | 'foreign' | 'unverified' | 'allFailed';

export interface IndexRunSummary {
  /** 이 실행이 <의도한 일을 했는가>. 아무것도 안 한 실행은 성공이 아니다. */
  ok: boolean;
  kind: IndexRunKind;
  /** 사람이 읽는 꼬리말. 알릴 것이 없으면 빈 문자열이다. */
  note: string;
}

/**
 * 🔴 `foreignDb` 만 보면 <소유 미확인>이 성공으로 읽힌다. 둘 다 "아무것도 안 했다" 이고
 *    호출부는 그 실행을 성공으로 세면 안 된다 — 자동화가 다음 단계로 넘어간다.
 *
 * 🔴 `failed` 를 빠뜨리면 "1,000개 중 999개 실패" 도 조용히 성공으로 보인다.
 *
 * 🔴🔴 그리고 <전부 실패>는 성공이 아니다 (코덱스 13차 P2). 한때 여기 "실패는 ok 를
 *    뒤집지 않는다 — 부분 성공은 실재한다" 고 적어 두었는데, 그 문장이 <성공이 0인
 *    경우>까지 덮었다. `indexed=0 · failed=1000` 이 `success: true` 로 나갔다.
 *    ★부분 성공이 실재한다는 것은 참이다. 틀린 것은 그것을 <성공이 0일 때까지> 늘린 것이다.
 *    그래서 선을 다시 긋는다: 성공이 하나라도 있으면 ok, 하나도 없는데 실패가 있으면 아니다.
 *
 * 🔴🔴 그리고 <읽지도 못한 것>은 `failed` 에 안 들어간다 (코덱스 14차 P2). 스캐너는
 *    읽기·파싱 실패를 `skippedFiles` 로 보낸다(scanner.ts). 그래서 볼트 전체가
 *    권한 오류로 한 장도 안 읽히는 실행이 `failed=0 · indexed=0` 이 되어
 *    <success: true> 로 나갔다. ★"실패 0" 이 "잘 됐다" 가 아닌 경우가 이것이다.
 *    → `skippedFiles` 를 <필수 인자>로 받는다. 선택으로 두면 부르는 쪽이 빠뜨려도
 *      조용하고, 이 저장소가 하루 종일 잡은 사고가 정확히 그 모양이다.
 */
export function summarizeIndexRun(r: Pick<IndexResult,
  'indexed' | 'deleted' | 'failed' | 'deferredDeletes' | 'foreignDb'
  | 'ownershipUnverified' | 'skippedFiles'>): IndexRunSummary {
  if (r.foreignDb) {
    return { ok: false, kind: 'foreign', note: '🔴 남의 DB — 아무것도 안 했다' };
  }
  if (r.ownershipUnverified) {
    return {
      ok: false, kind: 'unverified',
      note: '🔴 소유 미확인 — 아무것도 안 했다. 전체 색인을 한 번 돌려 소유를 확정하라',
    };
  }
  const unreadable = countUnreadable(r.skippedFiles);
  const parts: string[] = [];
  if (r.failed > 0) parts.push(`❌ 실패 ${r.failed}`);
  if (unreadable > 0) parts.push(`📛 못 읽음 ${unreadable}`);
  if (r.deferredDeletes > 0) parts.push(`👻 미룬 삭제 ${r.deferredDeletes}`);
  const note = parts.join(', ');
  // 🔴 <성공이 하나도 없는데 실패가 있다> = 이 실행은 아무것도 이루지 못했다.
  //    skipped(변경 없음)는 성공으로 세지 않는다 — 건드린 것이 전부 실패했다는 뜻이
  //    그대로 남아야 한다. 반대로 indexed·deleted 가 하나라도 있으면 부분 성공이다.
  //    ⚠️ `empty` 같은 <안정적인> 건너뜀은 여기 안 든다 — 빈 노트 3개짜리 볼트를
  //       영구히 실패로 만들지 않으려는 선이고, TRANSIENT_SKIPS 가 그 선이다.
  if (r.failed + unreadable > 0 && r.indexed === 0 && r.deleted === 0) {
    return { ok: false, kind: 'allFailed', note: note + ' — 성공한 것이 하나도 없다' };
  }
  return { ok: true, kind: 'ok', note };
}
