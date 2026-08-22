import { resolve } from 'node:path';

// 🔴 DB 와 볼트의 <짝>을 판정한다.
//
// 배경(실측 2026-08-21): CLI 의 DB 경로 결정은 `config.dbPath` 를 볼트 인자보다
// 위에 둔다. 그래서 `stellavault index /어딘가/작은폴더` 처럼 다른 볼트를 인자로 줘도
// 설정에 적힌 DB 에 붙는다. 그 상태로 색인하면 indexVault 가 "디스크에 없는 문서" 를
// 지우면서 <원래 볼트의 색인을 통째로 날린다>. 파일 2개짜리 폴더로 `Deleted: 17376`.
//
// ★삭제 가드로는 못 막는다 — 그 삭제는 규칙상 <올바른> 동작이다. 실패도 없고
//  못 읽은 파일도 없다. 막아야 하는 지점은 삭제가 아니라 짝짓기다.

/** `stellavault_meta` 에서 볼트 소유권을 담는 키. */
export const VAULT_OWNER_KEY = 'vault_path';

export type VaultOwnership =
  /** 처음 보는 DB — 지금 각인한다. */
  | { kind: 'claim'; vaultPath: string }
  /** 이 DB 는 이 볼트의 것이다. */
  | { kind: 'ok' }
  /** 다른 볼트의 DB 다 — 색인을 시작하면 안 된다. */
  | { kind: 'mismatch'; owner: string; here: string };

/**
 * @param owner DB 에 각인된 볼트 경로 (`undefined` = 아직 각인 안 됨)
 * @param here  지금 색인하려는 볼트의 <절대경로>
 *
 * 🔴 비교는 <문자열 그대로>다. 대소문자를 무시하거나 정규화로 뭉개면, 그 뭉개는
 *    규칙이 틀렸을 때 조용히 통과시켜 색인을 날린다. 애매하면 막는 쪽이 싸다 —
 *    막았을 때의 비용은 명령 한 번 다시 치는 것이고, 통과시켰을 때의 비용은 볼트다.
 */
export function checkVaultOwnership(owner: string | undefined, here: string): VaultOwnership {
  if (owner === undefined || owner === '') return { kind: 'claim', vaultPath: here };
  if (owner === here) return { kind: 'ok' };
  return { kind: 'mismatch', owner, here };
}

/**
 * 각인이 <없는> DB 를 이 볼트 것으로 봐도 되는가.
 *
 * 🔴 "문서 하나라도 겹치면 같은 볼트" 는 증명이 아니다 (코덱스 10차 P1).
 *    문서 id 는 <볼트 상대경로>의 해시라 볼트 경로가 안 들어간다. 서로 다른 두 볼트에
 *    `README.md` 가 하나씩만 있어도 겹침이 1 이 되어 가드가 풀린다.
 *
 * 🔴🔴 그리고 <작은 쪽 기준 비율>도 뚫린다. 처음 이렇게 썼다가 시험을 짜면서 봤다:
 *    DB 17,376개 · 스캔 2개면 min 은 2 라서, 우연히 하나만 겹쳐도 50% 가 된다.
 *    더 나쁜 것은 <첫 실행이 그 두 파일을 DB 에 넣는다>는 점이다 — 그러면 두 번째
 *    실행의 겹침은 스캔 기준 100% 가 되어 통과한다. 즉 사고가 한 번 밀릴 뿐이었다.
 *
 * ★그래서 두 갈래 중 하나를 요구한다:
 *
 *   ① `overlap >= existing × 0.5` — <이 DB 의 절반 이상이 이 볼트의 파일이다>.
 *      평범한 업그레이드가 여기로 통과한다(겹침이 사실상 DB 전체다).
 *      사고 모양(2개 vs 17,376개)은 8,688개가 필요해 절대 통과하지 못한다.
 *
 *      🔴 ①에는 <절대 하한이 없다>. 코덱스 13차가 이것을 P1 으로 지적했다:
 *      `(overlap=1, existing=1)` 인 남의 DB 도 통과한다 — 바로 위에서 "README 하나는
 *      증명이 아니다" 라고 해 놓고 ①이 그것을 통과시킨다는 것이다. <사실이다.>
 *
 *      🔴🔴 그 계산이 <틀렸었다> (코덱스 14차 P1). 여기 오래 "잃는 것은 최대
 *      `existing − overlap` 개" 라고 적혀 있었는데, 그것은 <겹치지 않은 것만> 센 수다.
 *      겹친 문서는 지워지지 않는 대신 `replaceDocument` 가 <내용을 덮어쓴다> —
 *      남의 볼트였다면 그 행도 잃은 것이다. ★올바른 상한은 <`existing` 전부>다.
 *      한 갈래(삭제)만 세고 다른 갈래(덮어쓰기)를 안 센 것이고, 이 저장소가 계속
 *      잡는 <두 계수가 같은 필터를 안 통과한> 부류다. 결론은 안 바뀌지만 근거는 바뀐다.
 *
 *      ⚠️ 그래도 하한을 넣지 않는다. 근거를 <고친 산수 위에> 다시 적는다:
 *      · ①이 잘못 통과했을 때 잃는 것은 <최대 `existing` 개>이고, ①로 들어온다는 것은
 *        곧 `existing` 이 작다는 뜻이다(크면 `overlap >= existing/2` 를 못 채운다).
 *        사고를 만든 것은 비율이 아니라 <규모>였고(17,376개), ①은 규모를 이미 막는다.
 *      · 하한을 넣으면 <정당한 작은 볼트>가 막힌다. 실측 반례: DB 3개 · 디스크 2개 ·
 *        겹침 2 (파일 하나를 지운 평범한 실행). 하한 50 이면 이 볼트는 <영영> 통과 못 한다.
 *      · 세 수(overlap·existing·scanned)만으로는 <1개짜리 남의 DB>와 <1개짜리 내 DB>를
 *        가를 수 없다. 가르려면 다른 신호가 필요하고, 그것은 이 함수 밖의 일이다.
 *      · 하한은 <되돌릴 수 없다>. 막힌 볼트에는 통과할 길이 없다 — 파일을 50개
 *        만들어 넣으라고 할 수는 없다. 반대로 잔여 위험은 규모로 상한이 잡힌다.
 *        <복구 불가능한 오거부>와 <작고 상한 있는 오수락> 중 후자를 고른다.
 *      ★그래서 이것은 <닫은 구멍이 아니라 계량된 잔여 위험>이다. 인용할 때 그렇게 적어라.
 *      ★코덱스가 13·14차에 <두 번> P1 으로 지적했다. 두 번 다 유지했고, 두 번째에
 *       산수 오류 하나가 실재했다. 판단은 유지하되 그 사실을 지우지 않는다.
 *
 *   ② `overlap >= scanned × 0.9` <b>이고</b> `overlap >= 50` —
 *      볼트가 크게 <늘거나 줄어> ①을 못 넘는 정상 상황을 구제한다.
 *      절대 하한 50 이 핵심이다: 경로 50개가 우연히 겹치는 두 볼트는 없다.
 *
 * 🔴 스캔이 비었으면 <물을 수 없다>. 볼트 경로를 잘못 줬거나 마운트가 안 된 상태가
 *    정확히 그 모양이고, 그때 각인하면 다음 실행이 전부 지운다.
 *
 * 🔴🔴 <통과 못 하면 <b>데이터를</b> 한 글자도 쓰지 않는다> — 삭제·각인·덮어쓰기·삽입 전부.
 *
 *    ⚠️ "한 글자도" 라고만 적었더니 <지킬 수 없는 약속>이 됐다 (코덱스 13차 P1).
 *    소유를 물으려면 `stellavault_meta` 를 읽어야 하고, 그러려면 DB 를 열어야 한다.
 *    여는 것 자체가 `journal_mode = WAL` 과 `CREATE TABLE IF NOT EXISTS` 를 실행한다.
 *    즉 <스키마와 저널 모드>는 판정 전에 이미 닿는다. 그것은 데이터를 지우거나 바꾸지
 *    않지만 <아무것도 안 쓴다>도 아니다. 약속을 실제 범위로 좁혀 적는다.
 *    🟢 그 구멍을 좁혔다 (코덱스 14차 P1): `peekVaultOwner` 가 <읽기 전용으로> 먼저 열어
 *    각인을 읽는다(store/peek-owner.ts). CLI 색인 경로는 그것으로 먼저 물으므로,
 *    남의 DB 는 <WAL 전환도 스키마 생성도 겪지 않고> 거부된다.
 *    ⚠️ 좁힌 것이지 닫은 것이 아니다 — `peekVaultOwner` 를 안 부르고 곧장
 *    `initialize()` 하는 경로(데스크톱·API 서버)는 여전히 남아 있다.
 *
 *    두 번 고쳐서 여기 왔다. 기록을 남긴다:
 *    ① 처음엔 "삭제만 건너뛴다. 넣는 것은 되돌릴 수 있으니까" 였다 → <틀렸다>.
 *       색인은 `replaceDocument` 로 하고 그것은 같은 id 의 기존 행을 덮는다.
 *    ② 그래서 "새 문서만 넣는다" 로 절충했다 → <이것도 틀렸다>(코덱스 12차 P1).
 *       그렇게 넣은 문서가 <다음 실행의 소유 증거>가 된다. 스캔이 50개만 넘으면
 *       두 번째 실행이 겹침 조건을 만족해 각인하고 원래 문서를 지운다 —
 *       "가드가 한 번만 막는" 바로 그 모양이 재현됐다.
 *    ★교훈: 증거를 만드는 쓰기는 <중립적인 쓰기가 아니다>.
 *
 * ⚠️ 그래도 정당한 첫 색인은 막히지 않는다. 모수를 <경로 해시 id 를 가진 문서>로
 *    한정했기 때문이다 — 새 DB 와 팩 전용 DB 는 `existing === 0` 이라 곧바로 통과한다.
 *    막히는 것은 <다른 볼트의 파일 문서가 이미 들어 있는> DB 뿐이다.
 *
 *    🔴 한때 여기 "ingest 전용 DB 도 빠진다" 고 적혀 있었는데 <거짓이었다> (코덱스 14차 P2).
 *    ingest 라우터는 파일 스캐너와 <같은 방식으로> id 를 만든다(경로 해시). 그래서
 *    `pathDerivedDocument`(옛 이름 ownedByFileIndex) 가 둘을 가르지 못한다. 다만 ingest 문서는 볼트 폴더 안에
 *    실제 파일로 저장되므로 분자·분모에 <함께> 들어와 비율을 뒤틀지 않는다.
 */
export const VAULT_OVERLAP_DB_RATIO = 0.5;
export const VAULT_OVERLAP_SCAN_RATIO = 0.9;
export const VAULT_OVERLAP_ABS_FLOOR = 50;

export function overlapIsConvincing(overlap: number, existing: number, scanned: number): boolean {
  // 🔴 <빈 DB> 를 먼저 본다. 순서가 중요하고, 한 번 뒤집었다가 되돌렸다:
  //    11차 지적("빈 스캔을 먼저 거부하라")대로 뒤집었더니 (0, 0, 0) 이 false 가 되어
  //    <새 볼트를 새 DB 로 초기화하는 정상 경로가 영영 막혔다>(코덱스 12차 P2).
  //    ★"스캔이 비면 각인하지 않는다" 는 <잃을 것이 있을 때>의 규칙이다. 파일 문서가
  //     0 개인 DB 는 잘못 각인해도 잃을 것이 없고, 틀렸으면 다음 실행이 mismatch 로 막는다.
  if (existing === 0) return true;      // 잃을 것이 없다
  if (scanned === 0) return false;      // 물을 수 없다 → 가져가지 않는다
  if (overlap >= existing * VAULT_OVERLAP_DB_RATIO) return true;
  return overlap >= VAULT_OVERLAP_ABS_FLOOR && overlap >= scanned * VAULT_OVERLAP_SCAN_RATIO;
}

/**
 * 소유가 <이미 확정된> DB 에서만 1회성 유지보수를 돌린다.
 *
 * 🔴 왜 필요한가: 유지보수를 `store.initialize()` 밖으로 뺐더니(12차 P1), 색인기만
 *    부르게 되어 <읽기 전용 경로>가 이관에서 빠졌다 (코덱스 13차 P2). `serve` 는
 *    감시자를 `ignoreInitial: true` 로 띄우므로 파일이 바뀌지 않는 한 색인기가 아예
 *    안 돌고, 그러면 링크 백필과 고아 임베딩 정리가 <영원히> 실행되지 않는다.
 *    고아 임베딩은 KNN 슬롯을 차지해 정상 결과를 밀어낸다 — 검색 품질에 직접 닿는다.
 *
 * 🔴 그렇다고 여는 순간 돌리면 12차에 막은 것이 되살아난다. 그래서 <각인이 이 볼트를
 *    가리킬 때만> 돈다. 각인이 없거나 다른 볼트면 아무것도 하지 않는다 —
 *    "모르면 안 만진다" 가 이 저장소의 기본값이다.
 *
 * @returns 실제로 돌렸으면 true
 */
export function runMaintenanceIfOwned(
  store: { getMeta(key: string): string | undefined; runMaintenanceOnce(): void },
  vaultPath: string,
): boolean {
  if (!vaultPath) return false;
  const ownership = checkVaultOwnership(store.getMeta(VAULT_OWNER_KEY), resolve(vaultPath));
  if (ownership.kind !== 'ok') return false;
  store.runMaintenanceOnce();
  return true;
}
