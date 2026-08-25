// Design Ref: §6.3 — Incremental Indexing + Pipeline

import { join, relative, dirname, basename, resolve } from 'node:path';

/** 옛 ingest 가 남긴 경로 구분자. 리터럴로 쓰면 편집 도구가 이스케이프를 먹는다. */
const BACKSLASH = String.fromCharCode(92);
import { createHash } from 'node:crypto';
import type { Embedder } from './embedder.js';
import type { VectorStore } from '../store/types.js';
import type { Document } from '../types/document.js';
import type { Chunk } from '../types/chunk.js';
import { existsSync, readdirSync } from 'node:fs';
import { scanVault, scanFile, docIdForPath, type SkippedFile } from './scanner.js';
import { sawUnreadable } from './report.js';
import { checkVaultOwnership, overlapIsConvincing, VAULT_OWNER_KEY } from '../store/vault-ownership.js';
import { chunkDocument, type ChunkOptions } from './chunker.js';
import { extractEntities } from './entity-extractor.js';
import { withRetry, errors } from '../utils/retry.js';

export { type Embedder } from './embedder.js';
export { createLocalEmbedder } from './local-embedder.js';
export { scanVault, scanFile, docIdForPath, type SkippedFile, type SkipReason } from './scanner.js';
export { chunkDocument, estimateTokens } from './chunker.js';
export { createWatcher } from './watcher.js';

/**
 * 삭제를 확정하기 전에 기다리는 시간(ms).
 * 원자적 저장의 unlink→rename 간격을 넘기기 위한 것이라 짧으면 된다.
 * 이 값은 <삭제 후보가 있을 때만> 든다 — 보통 배치는 한 번도 안 기다린다.
 */
const DELETE_SETTLE_MS = 60;

// 🔴 `TRANSIENT_SKIPS`·`sawUnreadable` 은 `report.ts` 로 옮겼다 (코덱스 14차 P2).
//    <삭제를 미루는 기준>과 <성공을 판정하는 기준>이 같은 정의를 봐야 한다.
//    두 벌로 두면 "삭제는 미뤘는데 요약은 성공" 이 나온다.

export interface IndexerOptions {
  store: VectorStore;
  embedder: Embedder;
  chunkOptions?: Partial<ChunkOptions>;
  onProgress?: (current: number, total: number, doc: Document) => void;
}

/** 여러 줄 경고문을 만들 때 쓴다. */
const NEWLINE = String.fromCharCode(10);

export interface IndexResult {
  indexed: number;
  /**
   * 🔴 <내용이 안 바뀌어 다시 굽지 않은> 문서 수. CLI 는 이것을 **"Unchanged"** 로 찍는다.
   *    읽기·파싱에 실패해 스캔에서 빠진 파일은 여기 넣지 않는다 — 그건 {@link skippedFiles} 다.
   *    한때 indexFiles 만 둘을 합산해, 같은 입력에 대해 indexVault 와 <다른 수>를 냈고
   *    스캔 실패가 화면에 "변경 없음" 으로 찍혔다 (코덱스 6a P2, 2026-08-21).
   */
  skipped: number;
  deleted: number;
  /**
   * 🔴 <지웠어야 하는데 미룬> 문서 수. 0 이 아니면 색인이 유령을 안고 있다는 뜻이다.
   *
   * 이번 실행이 불완전하면(실패·못 읽음) 삭제를 미룬다 — rename 과 겹치면 문서를
   * 통째로 잃기 때문이다. 그 대신 유령이 남는데, <조용히 남으면> 그건 그것대로 사고다.
   * 한 파일이 영구히 실패하면 삭제가 영영 안 일어날 수 있으므로 화면에 드러낸다
   * (코덱스 7차 P2, 2026-08-21).
   */
  deferredDeletes: number;
  failed: number;
  totalChunks: number;
  elapsedMs: number;
  totalFiles: number;
  skippedFiles: SkippedFile[];
  failedFiles: { path: string; error: string }[];
  /**
   * 🔴 이 DB 가 <이 볼트의 것이 아니어서> 아무것도 하지 않았다는 표시.
   *    deferredDeletes 와 뜻이 다르다 — 저쪽은 "이번엔 미뤘다", 이쪽은 "붙을 DB 가
   *    틀렸다" 다. 원인이 다르면 사용자가 할 일도 다르므로 호출부가 갈라 읽어야 한다
   *    (코덱스 10차 P2 — CLI 가 두 경우에 같은 안내를 냈다).
   */
  foreignDb?: boolean;
  /**
   * 🔴 각인이 없고 겹침 증거가 약해 <아무것도 하지 않았다>는 표시.
   *
   * ⚠️ 이 주석은 <한 번 썩었다>. 10~11차 시절에는 "색인은 했고 삭제만 건너뛰었다"
   *    였고, 12차에 규칙이 "한 글자도 쓰지 않는다" 로 바뀌었는데 <설명만 남았다>
   *    (코덱스 13차 P3). 공개 필드의 뜻이 구현과 어긋나면 호출부가 그 거짓을 믿는다.
   *
   * 🔴 그래도 {@link foreignDb} 와 <섞지 마라>. 지금은 둘 다 "아무것도 안 했다" 지만
   *    원인이 다르다 — 저쪽은 소유자가 <확정적으로 다르다>(DB 경로를 바꿔야 한다),
   *    이쪽은 <모른다>(전체 색인을 한 번 돌려 소유를 확정하면 풀린다).
   *    사용자가 할 일이 다르므로 값을 나눠 둔다.
   */
  ownershipUnverified?: boolean;
}

/**
 * 같은 파일의 <옛 형식> 행을 치운다.
 *
 * 🔴 반드시 정본 행이 확실히 있을 때만 부른다. 정본이 없는 상태에서 부르면
 *    그 문서를 통째로 잃는다 (코덱스 5차 P1, 2026-08-21).
 */
async function purgeLegacyRows(store: VectorStore, doc: Document): Promise<void> {
  // 🔴 이 정리는 <본 작업이 아니다>. 실패해도 색인은 이미 성공했으므로 삼킨다.
  //    안 삼키면 두 방향으로 거짓말을 한다 (코덱스 6a P2, 2026-08-21):
  //      ① unchanged 분기에서는 try 밖이라 <배치 전체가 reject> 된다
  //      ② changed 분기에서는 try 안이라 <성공한 색인이 failed 로> 집계된다
  //    남는 것은 중복 행 하나뿐이고, 그건 다음 실행이 다시 시도한다.
  try {
    for (const alias of idsForRelPath(doc.filePath)) {
      if (alias === doc.id) continue;
      if (await store.getDocument(alias)) await store.deleteByDocumentId(alias);
    }
  } catch (err) {
    console.error(`[index] 옛 형식 행 정리 실패 (${doc.filePath}): ${(err as Error)?.message ?? String(err)}`);
  }
}

/**
 * 한 상대경로가 가질 수 있는 문서 id <전부> — [정본, 옛 형식].
 *
 * 🔴 유도가 둘이다. 파일 스캐너는 경로를 슬래시로 정규화해 해시하지만, API ingest 는
 *    join() 결과(윈도우에서 역슬래시)를 <id 에도 file_path 에도> 그대로 쓴다
 *    (api/routes/ingest.ts · intelligence/ingest-pipeline.ts).
 *    그래서 documents.file_path 의 UNIQUE 도 이 둘을 <다른 값>으로 본다 —
 *    INSERT OR REPLACE 가 옛 행을 치우지 못하고 같은 파일이 두 행으로 남는다
 *    (코덱스 4차 P1, 2026-08-21. ⚠️ 3차 때 내가 "스키마가 막는다" 고 반박했는데
 *     <틀렸다>. 시험 픽스처가 file_path 를 슬래시로 넣어, 하필 그 지점에서 현실과 달랐다).
 *
 * ★호스트의 path.sep 을 쓰지 않는다 — 옛 형식은 "윈도우에서 만들어진 역슬래시" 라는
 *  <데이터의 성질>이지 이 프로세스가 도는 OS 의 성질이 아니다. sep 을 쓰면 같은 코드가
 *  리눅스 CI 에서 다르게 동작하고, 실제로 시험이 리눅스에서 깨졌다(코덱스 4차 P1).
 */
/**
 * 파일이 <이 대소문자 그대로> 있는가.
 *
 * 🔴 `existsSync` 로는 답할 수 없다 — 윈도우·macOS 기본 파일시스템은 대소문자를
 *    구분하지 않아 `foo.md` 를 `Foo.md` 로 바꿔도 옛 경로가 <있다고> 답한다.
 *    그러면 옛 문서 행이 삭제 후보에서 빠져 살아남고, SQLite 의 UNIQUE(file_path) 는
 *    두 문자열을 다른 값으로 보므로 같은 파일이 <두 행>이 되어 검색이 중복된다
 *    (코덱스 8차 P2, 2026-08-21).
 *
 * ⚠️ 덮는 범위는 <볼트 경계까지의 모든 칸>이다 — 상위 폴더의 대소문자 변경도 잡는다.
 *    (한때 "마지막 한 칸" 이라고 적혀 있었는데 구현과 반대였다. 코덱스 10차 P3.)
 *    조회에 실패하면 <있다고> 답한다 — 삭제 쪽에서 그것이 보수적인 답이다.
 *    단 ENOENT(부모가 정말 없다)는 <없다>로 답한다. 폴더 통째 삭제가 그 모양이다.
 */
/** 보고용 <파일 수> 계수 키. 구분자와 대소문자를 접는다. */
function pathCountKey(relPath: string): string {
  return relPath.split(BACKSLASH).join('/').toLowerCase();
}

function fileExistsExact(absPath: string, vaultRoot: string): boolean {
  // 🔴 <볼트 경계>에서 멈춘다. 예전에는 파일시스템 루트까지 거슬러 올라가서,
  //    볼트 경로 자체의 대소문자 표기만 달라도(설정에 f:/obsidian, 디스크는
  //    F:/Obsidian) 멀쩡한 파일을 "없다" 로 판정했다 — 그 값이 곧 삭제 허가다
  //    (코덱스 10차 P1). 볼트 위쪽은 애초에 우리가 판정할 일이 아니다.
  const stop = resolve(vaultRoot);
  // 🔴 코덱스 11차 P1 이 "경계 비교가 대소문자를 가려서 실존 파일을 없다고 볼 수 있다"
  //    고 지적했고, 접어 봤다가 <되돌렸다>. 결과를 바꾸는 경우를 만들 수 없었기 때문이다:
  //    · absPath 가 vaultRoot 에서 파생되면 접두사 표기가 <정의상 같다> → 접을 것이 없다.
  //    · 표기가 다르면 경계에서 못 멈추지만, 위쪽 성분은 디스크 표기 그대로라
  //      readdirSync 검사를 전부 통과하고 루트에서 true 를 준다 → 삭제 허가가 안 난다.
  //    · false 가 나오려면 <볼트 안쪽> 성분의 표기가 디스크와 달라야 하는데, 그것은
  //      정확히 우리가 <탐지하려는> 대소문자 rename 이다.
  //    ★변이(접기 제거)를 심어도 시험이 하나도 안 빨개졌다 — 즉 그 가드는 <잴 수 없다>.
  //     이 저장소는 닿지 않는 방어를 결함으로 친다(scanner 의 notStripped 와 같은 판정).
  try {
    let cur = resolve(absPath);
    for (;;) {
      if (cur === stop) return true;            // 볼트 경계에 닿았다
      const parent = dirname(cur);
      if (parent === cur) return true;          // 루트에 닿았다 = 경로가 볼트 밖이다
      if (!readdirSync(parent).includes(basename(cur))) return false;
      cur = parent;
    }
  } catch (err) {
    // 🔴 예전에는 여기서 existsSync(absPath) 를 돌려줬다 — 주석은 <있다고 답한다>고
    //    약속했는데 그 함수는 false 를 줄 수 있었고, 그 false 가 삭제를 허가했다
    //    (코덱스 10차 P1). 약속대로 <못 읽었으면 지우지 않는> 쪽으로 답한다.
    // ⚠️ 단 ENOENT 는 다르다 — 부모가 정말 없으면 파일도 없다(폴더 통째 삭제가 그 모양).
    //    그것까지 "있다" 로 하면 폴더를 지워도 유령이 영원히 남는다.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    return true;
  }
}

function idsForRelPath(relPath: string): string[] {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const canonical = relPath.split(BACKSLASH).join('/');
  const legacy = canonical.split('/').join(BACKSLASH);
  return canonical === legacy ? [hash(canonical)] : [hash(canonical), hash(legacy)];
}


/**
 * 이 문서의 id 가 <자기 경로에서 유도된 것>인가.
 *
 * 🔴 이름과 계약을 좁혔다 (코덱스 15차 P3). 원래 `pathDerivedDocument`(옛 이름 ownedByFileIndex) — "파일 색인이
 *    만든 것인가" — 였는데, 그것은 <이 함수가 답할 수 없는 질문>이다. 인자는 `id` 와
 *    `filePath` 뿐이고 API ingest 도 <같은 방식으로> id 를 만든다. 즉 파일 문서와
 *    ingest 문서는 원리적으로 구별되지 않는다.
 *    ★이름이 못 하는 것을 약속하면, 다음 사람이 그 약속 위에 판정을 쌓는다.
 *
 * 판정은 마커 목록이 아니라 <id 재유도>로 한다 — 경로에서 온 문서는 자기 경로를
 * 해시하면 자기 id 가 나오고, importPack 이 넣는 `pack_<name>` 은 안 나온다.
 *
 * 🔴 유도 방식이 <둘>이다. 파일 스캐너는 경로를 `/` 로 정규화해 해시하지만,
 *    API ingest 는 `join()` 결과(윈도우에서 `\`)를 그대로 해시한다
 *    (api/routes/ingest.ts). 하나만 보면 ingest 문서를 비파일로 오판해 영원히
 *    안 지우고, 중복·stale 행이 쌓인다 (코덱스 2차 P1, 2026-08-21).
 */
function pathDerivedDocument(d: { id: string; filePath: string }): boolean {
  return idsForRelPath(d.filePath).includes(d.id);
}

/**
 * vault를 스캔하여 변경된 문서만 벡터화하는 증분 인덱서
 */
export async function indexVault(
  vaultPath: string,
  options: IndexerOptions,
): Promise<IndexResult> {
  const start = Date.now();
  const { store, embedder, chunkOptions, onProgress } = options;

  // 🔴🔴 이 DB 가 <이 볼트의 것인가>. 아니면 <한 건도 지우지 않는다>.
  //
  // 실측 2026-08-21: 파일 2개짜리 스크래치 폴더를 색인했더니 `Deleted: 17376` —
  // 실볼트 색인이 통째로 사라졌다. CLI 의 DB 경로 결정이 `config.dbPath` 를
  // 볼트 인자보다 위에 두어, 볼트를 바꿔도 <같은 DB> 에 붙었기 때문이다.
  //
  // ★가드를 CLI 에만 두면 안 된다 — indexVault 를 부르는 입구가 5곳 더 있다
  //  (init 명령 · API /api/reindex · watcher · 데스크톱 2곳). 지우는 코드가
  //  여기 있으니 판정도 여기 있어야 한다.
  //
  // 🔴 던지지 않는다 — 경로 표기가 조금 달라진 것만으로(대소문자·심링크) 멀쩡히 돌던
  //    앱이 멈추면 안 된다. 대신 결과에 표시를 담아 호출부가 갈라 읽게 한다.
  //
  // ★결과가 <두 가지>다. 섞어 쓰면 CLI 와 API 가 거짓말을 한다 (코덱스 10차 P2):
  //   · foreignDb            = 소유자가 <확정적으로 다르다> → 한 글자도 안 쓰고 돌아간다
  //   · ownershipUnverified  = 각인이 없고 겹침 증거가 약하다 → <이쪽도> 한 글자도 안 쓴다
  //   ⚠️ 여기 "색인은 하되 삭제만 끈다" 라고 적혀 있었다 — 12차에 폐기된 규칙이다
  //     (코덱스 13차 P3). 둘의 차이는 <무엇을 했는가>가 아니라 <사용자가 할 일>이다.
  const here = resolve(vaultPath);
  const ownership = checkVaultOwnership(store.getMeta(VAULT_OWNER_KEY), here);

  // 🔴🔴 각인이 <다른 볼트>를 가리키면 이 실행은 아무것도 하지 않는다 (코덱스 10차 P1).
  //
  //   예전에는 "삭제만 끈다" 였는데, 그 사이 replaceDocument 가 <남의 문서 행을 교체>하고
  //   옛 별칭까지 지웠다. 즉 "삭제를 전부 건너뛴다" 는 로그가 <거짓>이었다. 상대경로가
  //   같은 파일(README.md 등)이 하나만 있어도 남의 문서와 청크가 통째로 바뀐다.
  //
  // 🔴 던지지는 않는다 — 경로 표기가 조금 다른 것만으로 앱이 멈추면 안 된다. 대신
  //    <한 글자도 안 쓰고> 돌아가고, 왜 아무 일도 안 했는지 시끄럽게 남긴다.
  if (ownership.kind === 'mismatch') {
    console.error(
      '[index] 🔴 이 DB 는 다른 볼트의 것이다 — 색인도 삭제도 하지 않는다.'
      + NEWLINE + '        DB 의 볼트: ' + ownership.owner
      + NEWLINE + '        지금 볼트 : ' + ownership.here,
    );
    return {
      indexed: 0, skipped: 0, deleted: 0, deferredDeletes: 0, failed: 0, totalChunks: 0,
      elapsedMs: Date.now() - start, totalFiles: 0, skippedFiles: [], failedFiles: [],
      foreignDb: true,
    };
  }
  // (겹침이 약하면 아래에서 <즉시 돌아간다> — 여기부터는 소유가 확인된 경로뿐이다)

  // 1. 스캔
  const scan = scanVault(vaultPath);
  const { documents } = scan;

  // 2. 기존 인덱스 상태 조회
  const existingDocs = await store.getAllDocuments();
  const existingMap = new Map(existingDocs.map(d => [d.id, d.contentHash]));

  // 🔴🔴 각인이 <없는> DB 를 그냥 가져가면 안 된다 (코덱스 9차 P1).
  //
  // 각인은 오늘 생긴 장치다. 그러니 이미 존재하는 모든 DB 는 각인이 없고, 그 상태에서
  // 처음 도는 색인이 <다른 폴더>라면 그 폴더 소유로 각인한 뒤 기존 행을 전부 지운다 —
  // 가드를 넣기 전과 똑같은 사고다. 각인만으로는 업그레이드 첫 실행을 못 막는다.
  //
  // 그래서 <겹침>을 본다. ⚠️ 한때 여기 "하나라도 겹치면 같은 볼트" 라고 적혀 있었는데
  //    그것은 구현이 아니다 — 두 볼트에 `README.md` 가 하나씩만 있어도 통과한다.
  //    실제 기준은 `overlapIsConvincing` 의 두 갈래이고 그 함수 주석이 정본이다.
  //    사고 당시 겹침은 0 이었다(파일 2개 vs 문서 17,376개) — 어느 갈래로도 안 통한다.
  //
  // 🔴 <스캔이 비었을 때>도 겹침 0 이다. 그것도 막아야 한다 — 볼트 폴더를 잘못
  //    가리켰거나 마운트가 안 됐을 때가 정확히 그 모양이고, 그때 지우면 전부 잃는다.
  if (ownership.kind === 'claim') {
    // 🔴🔴 겹침은 <경로>로 센다. id 로 세면 안 된다 (코덱스 11차 수정 중 실측).
    //   같은 파일이라도 옛 형식 id(역슬래시 경로)로 들어와 있으면 id 가 다르다 —
    //   그래서 id 기준으로는 <평범한 업그레이드가 겹침 0> 으로 나오고, 그 볼트는
    //   영원히 자기 DB 를 못 가져간다. 경로는 id 유도 방식이 바뀌어도 같다.
    //   ★pathCountKey 가 구분자와 대소문자를 접으므로 "같은 파일" 판정에 정확히 맞는다.
    //
    // 🔴 모수는 <경로 해시 id 를 가진 문서>만 센다. `pack_<name>` 처럼 경로에서
    //   유도되지 않는 id 는 빠진다 — 그것들만 든 DB 에 처음 색인할 때 "겹침 0" 으로
    //   걸려 버리기 때문이다(정당한 첫 색인이다).
    //
    // 🔴🔴 한때 여기 "ingest 문서도 빠진다" 고 적혀 있었는데 <거짓이었다> (코덱스 14차 P2).
    //   `pathDerivedDocument`(옛 이름 ownedByFileIndex) 는 `idsForRelPath(filePath).includes(id)` 로만 판정하는데,
    //   ingest 라우터도 <같은 방식으로> id 를 만든다(경로 해시, api/routes/ingest.ts:102).
    //   즉 이 함수는 파일 문서와 ingest 문서를 <가를 수 없다>. 원리적으로 못 가른다 —
    //   구별할 표식이 id 에 없다.
    //   ★그것이 여기서 <해롭지는> 않다: ingest 문서는 볼트 폴더 안에 실제 파일로
    //    저장되므로(`result.savedTo`) 다음 전체 스캔에 잡히고, 겹침의 <분자에도> 들어온다.
    //    분모와 분자에 함께 들어오니 비율이 안 뒤틀린다. 해로운 것은 <주석이 거짓인 것>이라
    //    고친다 — 다음 사람이 "ingest 는 안 세니까" 를 전제로 판정을 바꾸면 그때 깨진다.
    const ownedPaths = new Set<string>();
    for (const d of existingDocs) if (pathDerivedDocument(d)) ownedPaths.add(pathCountKey(d.filePath));
    const overlap = documents.reduce((n, d) => (ownedPaths.has(pathCountKey(d.filePath)) ? n + 1 : n), 0);
    if (!overlapIsConvincing(overlap, ownedPaths.size, documents.length)) {
      // 🔴🔴 <각인하지 않고, 한 글자도 쓰지 않고> 돌아간다.
      //   각인을 검증보다 <먼저> 하던 시절에는 잘못된 볼트도 첫 실행에서 소유권을
      //   가져갔고 두 번째 실행이 원본을 전부 지웠다 (코덱스 10차 P1). 여기를 두 번 고쳤고 둘 다 틀렸었다:
      //   ① "삭제만 건너뛴다" → replaceDocument 가 남의 행을 덮어썼다 (11차 P1).
      //   ② "새 문서만 넣는다" → 그렇게 넣은 문서가 <다음 실행의 소유 증거>가 되어
      //      두 번째 실행이 각인하고 원본을 지웠다 (12차 P1). 가드가 1회용이 됐다.
      //   ★증거를 만드는 쓰기는 중립적이지 않다. 그래서 삽입까지 막는다.
      console.error(
        '[index] 🔴 이 DB 가 이 볼트의 것이라는 증거가 약하다 — 아무것도 하지 않는다.'
        + NEWLINE + '        DB 파일문서 ' + ownedPaths.size + ' · 스캔 문서 '
        + documents.length + ' · 겹침 ' + overlap
        + NEWLINE + '        볼트/DB 짝이 맞다면 STELLAVAULT_DB_PATH 를 확인하고 다시 실행하라.',
      );
      return {
        indexed: 0, skipped: 0, deleted: 0, deferredDeletes: 0, failed: 0, totalChunks: 0,
        elapsedMs: Date.now() - start, totalFiles: scan.scannedFiles,
        skippedFiles: [], failedFiles: [], ownershipUnverified: true,
      };
    } else {
      // 🔴 원자적으로 주장한다. 동시에 도는 다른 색인이 이미 가져갔다면 <그쪽이 이긴다>.
      const winner = store.claimMeta(VAULT_OWNER_KEY, here);
      if (winner !== here) {
        // 🔴🔴 진 쪽은 mismatch 와 <같은 처지>다 — 소유자가 확정적으로 다르다.
        //   한때 여기서 표시만 세우고 계속 진행했는데, 그러면 승자의 DB 에
        //   replaceDocument 가 그대로 쓴다 (코덱스 10차 P1).
        console.error(
          '[index] 🔴 각인 경합에서 졌다 — 다른 프로세스가 이 DB 를 먼저 가져갔다.'
          + NEWLINE + '        소유자: ' + winner + ' · 지금 볼트: ' + here,
        );
        return {
          indexed: 0, skipped: 0, deleted: 0, deferredDeletes: 0, failed: 0, totalChunks: 0,
          elapsedMs: Date.now() - start, totalFiles: scan.scannedFiles,
          skippedFiles: [], failedFiles: [], foreignDb: true,
        };
      }
    }
  }

  // 🔴 소유가 확정된 <뒤에> 1회성 유지보수를 돌린다 (코덱스 12차 P1).
  //    예전에는 store.initialize() 안에 있어서, 남의 DB 라도 여는 순간 실행됐다.
  store.runMaintenanceOnce();

  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let totalChunks = 0;
  const failedFiles: { path: string; error: string }[] = [];

  // 3. 증분 처리 (에러 복구 포함)
  //
  // 🔴 옛 형식 id 로 들어와 있는 <같은 파일>의 행을 치운다. file_path 까지 역슬래시라
  //    UNIQUE 가 안 걸려 INSERT OR REPLACE 로는 안 사라진다 (코덱스 4차 P1).
  //    ★단, <정본 행이 확실히 있을 때만> 치운다. 한때 이 수집을 try 밖에서 미리 하고
  //     끝에서 무조건 지웠는데, 임베딩이 실패하면 정본은 안 써지고 옛 행만 사라져
  //     <문서를 통째로 잃었다> (코덱스 5차 P1, 2026-08-21 재현: failed=1 · 두 행 다 없음).
  //     이 함수가 고치려던 바로 그 유실을 정리 코드가 다시 만든 것이다.
  //    ★그리고 이것은 <중복 정리>지 파일 삭제가 아니다 — deleted 에 넣지 않는다.
  const legacyAliases = new Set<string>();
  const collectAliases = (doc: Document) => {
    for (const alias of idsForRelPath(doc.filePath)) {
      if (alias !== doc.id && existingMap.has(alias)) legacyAliases.add(alias);
    }
  };
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    onProgress?.(i + 1, documents.length, doc);

    // content_hash 비교 → 변경 없으면 SKIP
    if (existingMap.get(doc.id) === doc.contentHash) {
      collectAliases(doc);          // 정본 행이 있다는 뜻이다 — 옛 행은 중복이다
      skipped++;
      continue;
    }

    try {
      // 청킹
      const chunks = chunkDocument(doc.id, doc.content, chunkOptions);

      // 임베딩 (retry with backoff)
      const texts = chunks.map(c => c.content);
      const embeddings = await withRetry(
        () => embedder.embedBatch(texts),
        { maxRetries: 2, baseDelayMs: 1000 },
      );
      const chunksWithEmbeddings: Chunk[] = chunks.map((c, j) => ({
        ...c,
        embedding: embeddings[j],
        entities: extractEntities({
          content: c.content,
          heading: c.heading,
          title: doc.title,
          tags: doc.tags,
        }),
      }));

      // 저장 — 문서와 청크를 <한 트랜잭션으로>.
      // 🔴 따로 부르면 안 된다: upsertDocument 의 INSERT OR REPLACE 가 FK cascade 로
      //    <기존 청크를 먼저 날리고>, 그 뒤 청크 쓰기가 실패하면 문서는 남았는데
      //    청크가 0 개인 <검색 안 되는 문서>가 된다 (코덱스 6a P1, 2026-08-21 실측 1→0).
      // links 는 replaceDocument 안에서 같은 트랜잭션으로 파생·기록된다.
      await store.replaceDocument(doc, chunksWithEmbeddings);
      collectAliases(doc);          // 정본이 실제로 써진 <뒤에만>

      indexed++;
      totalChunks += chunks.length;
    } catch (err) {
      // Graceful degradation: skip failed file, continue with rest
      failed++;
      failedFiles.push({ path: doc.filePath, error: (err as Error)?.message ?? String(err) });
      console.error(errors.indexingFailed(doc.filePath, err).format());
    }
  }

  // 4. 삭제된 파일 처리
  //
  // 🔴 <디스크에 있는데 못 읽은 파일>을 <지워진 파일>로 오인하지 않는다.
  //    scanVault 는 parse-error/empty/too-large/unreadable 를 documents 가 아니라
  //    skipped 로 돌린다. 예전에는 이 집합을 documents 로만 만들어서, 한 번 읽기에
  //    실패한 문서가 그대로 색인에서 <축출>됐다 — 파일은 멀쩡히 있는데 검색이 안 된다.
  //    실측 2026-08-20: 한 번의 index 실행이 이 경로로 문서 128개를 지웠다.
  //    ★삭제는 되돌릴 수 없는 쪽이므로, 애매하면 <남긴다>.
  //    ★그리고 여기 넣는 id 도 <소유 판정과 같은 집합>이어야 한다. 한쪽만 두 유도를
  //     알면 나머지 한쪽이 그 문서를 "못 봤다" 고 판정해 지운다 (코덱스 3차 P1).
  const seenOnDisk = new Set<string>();
  for (const d of scan.documents) for (const id of idsForRelPath(d.filePath)) seenOnDisk.add(id);
  for (const sk of scan.skipped) for (const id of idsForRelPath(sk.path)) seenOnDisk.add(id);

  // 🔴 그리고 삭제 후보는 <이 볼트의 파일 색인이 소유한> 문서뿐이다.
  //    importPack 은 id `pack_<name>` / filePath `[pack] <name>` 인, 디스크에 없는
  //    문서를 같은 저장소에 넣는다. 소유를 안 가리면 다음 색인이 그것을 지운다
  //    (코덱스 P1, 2026-08-21 — 이 함수가 고치려던 바로 그 부류의 유실이다).
  //    ★판정은 마커 목록이 아니라 <id 재유도>로 한다. 파일에서 온 문서는
  //     docIdForPath(자기 경로) 가 반드시 자기 id 를 되돌려주고, 팩 문서는 아니다.
  //     마커를 세면 새 비파일 문서가 생길 때마다 조용히 뚫린다.
  for (const alias of legacyAliases) {
    // 정리 실패가 <색인 전체를 무너뜨리지> 않게 한다 — 위 purgeLegacyRows 와 같은 이유.
    try {
      await store.deleteByDocumentId(alias);
    } catch (err) {
      console.error(`[index] 옛 형식 행 정리 실패 (${alias}): ${(err as Error)?.message ?? String(err)}`);
    }
  }

  // 🔴 deleted 는 <사라진 파일 수>다. 한 파일이 정본·옛형식 두 행으로 있을 수 있으므로
  //    행이 아니라 <정규화된 경로>를 센다 (코덱스 5차 P2, 2026-08-21).
  //    이 수가 오염되면 다시 유령을 쫓게 된다 — 이 세션이 128 이라는 수로 그렇게 됐다.
  //
  // 🔴🔴 이번 실행에 <실패한 파일이 있으면 삭제를 통째로 미룬다>.
  //     rename 하나가 그 사이에 끼면 문서를 잃는다: `old.md` → `new.md` 로 바꾼 직후
  //     임베더가 죽으면, 새 경로는 failed 로 안 써지는데 옛 경로는 "디스크에 없다" 로
  //     지워져 <그 문서가 색인에서 완전히 사라진다> (코덱스 6a P1, 2026-08-21).
  //     ★삭제를 미루면 유령이 한 세대 남을 뿐이고 다음 정상 실행이 치운다.
  //      반대 방향(잘못 지움)은 되돌릴 방법이 없다. 값이 다른 두 실수다.
  //
  // 🔴 `failed` 만 보면 <스캔에서 못 읽은 파일>이 이 가드를 통과한다. rename 의 새 이름이
  //    잠겨 있거나 읽기 실패면 그 파일은 skipped 로 가서 failed 를 안 올리는데,
  //    옛 이름은 "디스크에 없다" 로 지워진다 — 결국 문서가 사라진다 (코덱스 7차 P1).
  // 🔴 계수 키는 <대소문자를 접은> 경로다. 대소문자를 안 가리는 파일시스템에서는
  //    Foo.md 와 foo.md 가 <같은 파일>인데 SQLite 는 두 행으로 들고 있어서,
  //    둘이 함께 사라지면 한 파일을 2건으로 셌다 (코덱스 10차 P2).
  //    ⚠️ 대소문자를 <가리는> 파일시스템에서는 진짜 다른 두 파일을 1건으로 센다.
  //      그쪽 실수는 보고 수가 작아지는 것뿐이고, 삭제 판정은 id 단위라 영향이 없다.
  const deletedPaths = new Set<string>();
  const deferredPaths = new Set<string>();
  const unreadable = sawUnreadable(scan.skipped);
  if (failed > 0 || unreadable) {
    console.error(
      `[index] 이번 실행이 불완전하다(실패 ${failed} · 못 읽음 ${unreadable ? 'Y' : 'N'})`
      + ' — 삭제를 미룬다. 다음 정상 실행에서 정리된다.',
    );
    for (const d of existingDocs) {
      if (seenOnDisk.has(d.id) || !pathDerivedDocument(d)) continue;
      if (fileExistsExact(join(vaultPath, d.filePath.split(BACKSLASH).join('/')), vaultPath)) continue;
      deferredPaths.add(pathCountKey(d.filePath));
    }
  } else {
    // 🔴🔴 한 파일이 <여러 행>일 수 있다(정본 · 옛 형식 · 대소문자 변형). 행을 하나씩
    //   지우면 두 번째에서 실패했을 때 <부분 삭제>가 남고, 그 순간 무엇을 보고하든
    //   거짓이 된다 — deleted 를 세면 한 행이 남아 계속 검색되고, 안 세면 한 행이
    //   사라진 상태다. indexFiles 에는 이 처방을 넣었는데 <여기만 빠져 있었다>
    //   (코덱스 11차 P2). 게다가 여기엔 try/catch 도 없어, 한 행의 실패가
    //   indexVault 전체를 <결과 없이> reject 시켰다 — 앞서 지운 것들은 이미 사라진 채로.
    const doomedByFile = new Map<string, string[]>();
    for (const d of existingDocs) {
      // (옛 별칭은 위에서 이미 치웠고 seenOnDisk 에도 들어 있어 여기 오지 않는다)
      if (seenOnDisk.has(d.id)) continue;
      if (!pathDerivedDocument(d)) continue;                            // 경로에서 온 문서가 아니다
      // 🔴 스캔 시점과 지금 사이에 파일이 <되살아났을> 수 있다. 에디터의 원자적 저장은
      //    unlink → rename 이고, 큰 볼트에서 이 두 시점 사이는 수 초다.
      //    indexFiles 는 이미 이 재확인을 하는데 여기만 안 했다 (코덱스 6a P1).
      if (fileExistsExact(join(vaultPath, d.filePath.split(BACKSLASH).join('/')), vaultPath)) continue;
      const key = pathCountKey(d.filePath);
      const ids = doomedByFile.get(key);
      if (ids) ids.push(d.id);
      else doomedByFile.set(key, [d.id]);
    }
    for (const [key, ids] of doomedByFile) {
      try {
        await store.deleteByDocumentIds(ids);
        deletedPaths.add(key);
      } catch (err) {
        failed++;
        failedFiles.push({ path: key, error: (err as Error)?.message ?? String(err) });
        console.error(errors.indexingFailed(key, err).format());
      }
    }
  }
  const deleted = deletedPaths.size;

  return {
    indexed,
    skipped,
    deleted,
    deferredDeletes: deferredPaths.size,
    failed,
    totalChunks,
    elapsedMs: Date.now() - start,
    totalFiles: scan.scannedFiles,
    skippedFiles: scan.skipped,
    failedFiles,
    // (여기 오면 소유는 확인됐다 — 미확인이면 위에서 이미 돌아갔다)
    ownershipUnverified: false,
  };
}

/**
 * Design Ref: §6.3 — Targeted incremental index (T2-2).
 *
 * Index ONLY the given absolute file paths (the desktop watcher's changed batch),
 * instead of re-walking + re-hashing the entire vault via {@link indexVault}.
 * Per-file content-hash skip is preserved (unchanged files re-embed nothing).
 * Paths that no longer exist on disk are treated as deletions and removed from
 * the index. Errors on individual files degrade gracefully (skip + continue).
 *
 * @param vaultPath - vault root (for relative-path / id derivation)
 * @param filePaths - absolute paths of changed/added/removed *.md files
 */
export async function indexFiles(
  vaultPath: string,
  filePaths: string[],
  options: IndexerOptions,
): Promise<IndexResult> {
  const start = Date.now();
  const { store, embedder, chunkOptions, onProgress } = options;

  // 🔴🔴 형제 진입점에도 같은 문이 있어야 한다 (코덱스 10차 P1).
  //   indexFiles 는 문서를 직접 교체하고 직접 지운다. 데스크톱 감시자가 이것을
  //   <indexVault 를 거치지 않고> 부르므로, indexVault 만 지키면 DB 짝짓기 안전은
  //   성립하지 않는다.
  const here = resolve(vaultPath);
  const ownership = checkVaultOwnership(store.getMeta(VAULT_OWNER_KEY), here);
  if (ownership.kind === 'mismatch') {
    console.error(
      '[index] 🔴 이 DB 는 다른 볼트의 것이다 — 배치 색인을 하지 않는다.'
      + NEWLINE + '        DB 의 볼트: ' + ownership.owner + ' · 지금 볼트: ' + ownership.here,
    );
    return {
      indexed: 0, skipped: 0, deleted: 0, deferredDeletes: 0, failed: 0, totalChunks: 0,
      elapsedMs: Date.now() - start, totalFiles: 0, skippedFiles: [], failedFiles: [],
      foreignDb: true,
    };
  }
  // Only the changed docs' hashes matter — fetch the full existing map once and
  // look up each by id (cheaper than a vault-wide diff). (§6.3)
  // 🔴 소유 판정보다 <먼저> 부른다 — 판정의 모수가 여기서 나온다.
  const existingDocs = await store.getAllDocuments();
  const existingMap = new Map(existingDocs.map(d => [d.id, d.contentHash]));

  // 🔴🔴 각인이 없을 때의 규칙은 indexVault 와 <같다>: 증거가 없으면 한 글자도 안 쓴다.
  //
  //   여기 오래 비대칭이 있었다 — "배치는 볼트 일부만 보니 겹침을 물을 수 없다.
  //   그러니 각인만 미루고 색인은 계속한다." 그 절충이 <틀렸다>(코덱스 12차 P1):
  //   그렇게 쓴 문서가 다음 indexVault 실행의 <소유 증거>가 되어, 가드가 한 번만
  //   막는 가드가 된다. 겹침을 못 묻는다는 사실은 쓰기를 허락할 근거가 아니라
  //   <더 막을 근거>다.
  //
  //   ⚠️ 그렇다고 영영 못 쓰게 되지는 않는다. 물을 수 있는 질문 하나가 남아 있다 —
  //   <이 DB 에 파일 색인이 소유한 문서가 하나라도 있는가>. 0 이면 여기서 각인하고
  //   진행한다(새 볼트 + 감시자만 도는 데스크톱 경로가 이것이다).
  //   0 이 아니면 남의 볼트일 수 있고, 그 판정은 볼트 전체를 보는 indexVault 만 한다.
  //
  //   🔴🔴 두 번 좁혔다. 처음엔 "0 이면 <잃을 것이 없다>" 였고 그것은 과장이었다
  //   (코덱스 13차 P1) — 정확히는 <파일 문서를> 잃지 않는다는 뜻이었다. 그래서
  //   주석만 좁혔는데, <그것으로 부족했다> (코덱스 14차 P1):
  //
  //   `pathDerivedDocument`(옛 이름 ownedByFileIndex) 가 `pack_<name>` 을 빼므로 <팩만 든 DB> 는 owned=0 이 되고,
  //   배치 색인이 그 DB 를 각인해 가져간다. 그 다음 디스크에 진짜 `[pack] foo.md` 가
  //   있으면 `UNIQUE(file_path)` 충돌로 `INSERT OR REPLACE` 가 팩 행을 밀어낸다.
  //   즉 "잃을 것이 없다" 는 <팩을 안 세었기 때문에> 나온 답이었다.
  //
  //   → 그래서 <문서가 한 행이라도 있으면> 배치 색인은 각인하지 않는다. 종류를 안 가린다.
  //   ★가릴 수도 없다: ingest 문서는 파일 문서와 <같은 방식으로 id 를 만들어> 원리적으로
  //    구별이 안 된다(코덱스 14차 P2). 가를 수 없는 것으로 판정을 세우지 않는다.
  //
  //   대가: 팩·ingest 만 든 DB 는 `stellavault index <볼트>` 를 한 번 돌려야 각인된다.
  //   그 경로는 열려 있다 — indexVault 는 볼트 전체를 보므로 겹침을 실제로 <물을 수> 있다.
  //   여기(배치)는 파일 몇 개만 보므로 물을 수가 없고, 그것이 이 비대칭의 이유다.
  if (ownership.kind === 'claim') {
    const owned = existingDocs.length;
    if (owned > 0) {
      console.error(
        '[index] 🔴 각인 없는 DB 에 이미 문서가 있다 — 배치 색인은 아무것도 하지 않는다.'
        + NEWLINE + '        DB 문서 ' + owned + ' · 지금 볼트: ' + here
        + NEWLINE + '        `stellavault index <볼트>` 로 전체 색인을 한 번 돌려 소유를 확정하라.',
      );
      return {
        indexed: 0, skipped: 0, deleted: 0, deferredDeletes: 0, failed: 0, totalChunks: 0,
        elapsedMs: Date.now() - start, totalFiles: 0, skippedFiles: [], failedFiles: [],
        ownershipUnverified: true,
      };
    }
    // 🔴 원자적으로 주장한다 — 동시에 도는 다른 색인이 이미 가져갔다면 그쪽이 이긴다.
    const winner = store.claimMeta(VAULT_OWNER_KEY, here);
    if (winner !== here) {
      console.error(
        '[index] 🔴 각인 경합에서 졌다 — 다른 프로세스가 이 DB 를 먼저 가져갔다.'
        + NEWLINE + '        소유자: ' + winner + ' · 지금 볼트: ' + here,
      );
      return {
        indexed: 0, skipped: 0, deleted: 0, deferredDeletes: 0, failed: 0, totalChunks: 0,
        elapsedMs: Date.now() - start, totalFiles: 0, skippedFiles: [], failedFiles: [],
        foreignDb: true,
      };
    }
  }

  // 🔴 소유가 확정된 <뒤에> 1회성 유지보수를 돌린다 (코덱스 12차 P1).
  store.runMaintenanceOnce();

  let indexed = 0;
  let skipped = 0;
  let deleted = 0;
  let deferredDeletes = 0;
  let failed = 0;
  let totalChunks = 0;
  const skippedFiles: SkippedFile[] = [];
  const failedFiles: { path: string; error: string }[] = [];

  // De-dup while preserving order (a batch may list the same path twice).
  const uniquePaths = [...new Set(filePaths)];
  const deleteCandidates: string[] = [];

  for (let i = 0; i < uniquePaths.length; i++) {
    const filePath = uniquePaths[i];

    // Deletion: path gone from disk → drop its index rows.
    // 🔴 단, <지금 이 순간> 없다고 바로 지우지 않는다. 에디터의 원자적 저장은
    //    unlink → rename 이라 그 사이에 파일이 잠깐 사라진다. watcher 가 그 틈에
    //    이벤트를 주면 멀쩡한 문서를 지우게 된다 (코덱스 P2, 2026-08-21).
    //    → 후보로만 적어 두고 배치가 끝난 뒤 다시 확인한다. 되돌릴 수 없는 쪽이므로.
    // 🔴 여기도 대소문자를 본다. 전체 색인만 고치고 증분 경로를 두면, 윈도우에서
    //    foo.md → Foo.md 뒤 옛 경로가 "있다" 로 판정돼 삭제 후보에서 빠지고
    //    두 행이 영원히 남는다 (코덱스 10차 P2).
    if (!fileExistsExact(filePath, vaultPath)) { deleteCandidates.push(filePath); continue; }

    const result = scanFile(vaultPath, filePath);
    if ('skipped' in result) {
      // 🔴 skipped 는 <변경 없음> 수다. 스캔 실패는 skippedFiles 로만 간다 —
      //    여기 더하면 화면에 "Unchanged" 로 찍혀 읽는 사람을 속인다 (코덱스 6a P2).
      skippedFiles.push(result.skipped);
      continue;
    }
    const doc = result.document;
    onProgress?.(i + 1, uniquePaths.length, doc);

    // content_hash 비교 → 변경 없으면 SKIP
    if (existingMap.get(doc.id) === doc.contentHash) {
      // 🔴 그래도 <옛 형식 중복>은 치운다. 여기서 그냥 돌아가면 정본·옛형식이 함께 있는
      //    파일은 내용이 안 바뀌는 한 영원히 두 행으로 남는다 (코덱스 5차 P1, 2026-08-21).
      //    정본 행이 있다는 것은 해시가 맞았다는 사실이 이미 보증한다.
      await purgeLegacyRows(store, doc);
      skipped++;
      continue;
    }

    try {
      const chunks = chunkDocument(doc.id, doc.content, chunkOptions);
      const texts = chunks.map(c => c.content);
      const embeddings = await withRetry(
        () => embedder.embedBatch(texts),
        { maxRetries: 2, baseDelayMs: 1000 },
      );
      const chunksWithEmbeddings: Chunk[] = chunks.map((c, j) => ({
        ...c,
        embedding: embeddings[j],
        entities: extractEntities({
          content: c.content,
          heading: c.heading,
          title: doc.title,
          tags: doc.tags,
        }),
      }));

      // 한 트랜잭션 — 위 indexVault 와 같은 이유다 (코덱스 6a P1).
      await store.replaceDocument(doc, chunksWithEmbeddings);

      await purgeLegacyRows(store, doc);                  // 정본이 실제로 써진 <뒤에만>


      indexed++;
      totalChunks += chunks.length;
    } catch (err) {
      failed++;
      failedFiles.push({ path: doc.filePath, error: (err as Error)?.message ?? String(err) });
      console.error(errors.indexingFailed(doc.filePath, err).format());
    }
  }

  // 삭제 2차 확인 — 배치를 다 처리한 뒤에도 <여전히> 없는 것만 지운다.
  // 원자적 저장(unlink → rename)의 틈에 들어온 이벤트는 여기서 걸러진다.
  //
  // 🔴 단, unlink 하나만 든 배치는 첫 검사 <바로 다음 줄>에서 재확인하게 되어
  //    안정화 시간이 0 이다 — rename 이 다음 tick 에 끝나면 그대로 지운다
  //    (코덱스 2차 P2, 2026-08-21). 후보가 있을 때만 짧게 기다린다.
  if (deleteCandidates.length > 0) {
    await new Promise(resolve => setTimeout(resolve, DELETE_SETTLE_MS));
  }
  // 🔴 indexVault 와 같은 규칙 — 실패가 있으면 삭제를 미룬다. watcher 배치의
  //    [old.md unlink, new.md add] 는 rename 이고, new 가 실패하면 둘 다 잃는다.
  // 🔴 후보를 <실제로 지워질 것>으로 먼저 좁힌다. 그래야 "미뤘다" 와 "지웠다" 가
  //    같은 식을 쓴다. 예전에는 미룸 계수만 <날 후보 수>를 써서, 되살아난 파일이나
  //    애초에 색인에 없던 파일까지 유령으로 세어 <있지도 않은 할 일>을 보고했다
  //    (코덱스 8차 P2, 2026-08-21).
  const doomed: string[] = [];
  // 🔴 조회 자체가 실패해 <행이 있는지 모른 채> 후보로 남긴 <경로들>. 보고에 쓴다.
  //    🔴🔴 수가 아니라 <집합>이다 (코덱스 14차 P2). 수로 세었더니 아래에서 doomed 를
  //    `stillGone` 으로 다시 거른 뒤에도 그 수가 안 줄어, "삭제 0건을 미룬다,
  //    그중 1건은 조회 실패" 같은 <산수가 안 맞는 보고>가 나올 수 있었다.
  //    ★같은 부류의 결함을 이 자리에서 세 번째 고친다 — 두 계수가 <같은 필터를
  //     통과한 것>을 세야 한다는 규칙이 여기 계속 안 지켜진다.
  const uncertain = new Set<string>();
  for (const filePath of deleteCandidates) {
    if (fileExistsExact(filePath, vaultPath)) continue; // 되살아났다 = 저장 중이었다
                                                        // (대소문자까지 같아야 '있다')
    try {
      // 두 유도 모두 본다 — 한쪽만 보면 다른 쪽이 stale 로 영원히 남는다.
      for (const id of idsForRelPath(relative(vaultPath, filePath))) {
        if (await store.getDocument(id)) { doomed.push(filePath); break; }
      }
    } catch (err) {
      // 조회가 실패했으면 <있다고 보고> 후보로 남긴다 — 없다고 단정하면 유실을 놓친다.
      uncertain.add(filePath);
      doomed.push(filePath);
      console.error(`[index] 삭제 후보 조회 실패 (${filePath}): ${(err as Error)?.message ?? String(err)}`);
    }
  }

  const unreadable = sawUnreadable(skippedFiles);
  if ((failed > 0 || unreadable) && doomed.length > 0) {
    // 🔴 미룬 수는 <실제로 지워졌을 것>과 같은 식으로 센다. doomed 를 만든 뒤에도
    //    시간이 흘러 파일이 되살아날 수 있는데(원자적 저장), 삭제 경로는 아래에서
    //    그것을 다시 확인하는 반면 미룸 계수는 안 했다 — "같은 식을 쓴다" 는 주석이
    //    거짓이었고, 있지도 않은 할 일을 보고했다 (코덱스 10차 P2).
    // 🔴 코덱스 11차 P2 는 "미룬 수가 DB 행 존재를 안 본다" 고 했는데 <대체로 틀렸다>:
    //    doomed 는 getDocument 로 걸러 담긴다(위 후보 좁히기). ⚠️ 예외가 하나 있다 —
    //    <조회 자체가 실패한> 후보는 확인 없이 담긴다(보수적으로, 유실을 놓치지 않으려고).
    //    그것을 `uncertain` 집합에 담아 아래 로그에 함께 적는다 (코덱스 12차 P2).
    //    🔴 그 집합도 <stillGone 으로 다시 거른다> (14차 P2) — 안 그러면 두 수가 갈린다.
    //    여기에 재확인을 덧대 봤다가 되돌렸다 — 중복인 데다 <더 나빴다>:
    //    ① getDocument 가 던지면 그 예외가 indexFiles 밖으로 나간다(위쪽은 catch 한다).
    //    ② 조회 실패를 "행 없음" 으로 세게 되어, 보수적으로 남기던 판정이 뒤집힌다.
    //    ★변이(재확인 제거)가 <살아남은 것>이 단서였다. 시험이 못 가르는 차이라면
    //     그것은 대개 <차이가 없거나> 내가 잘못 고친 것이다 — 여기서는 둘 다였다.
    const stillGone = doomed.filter(p => !fileExistsExact(p, vaultPath));
    const uncertainCandidates = stillGone.reduce((n, p) => (uncertain.has(p) ? n + 1 : n), 0);
    console.error(
      `[index] 이번 배치가 불완전하다(실패 ${failed} · 못 읽음 ${unreadable ? 'Y' : 'N'})`
      + ` — 삭제 ${stillGone.length}건을 미룬다.`
      + (uncertainCandidates > 0
        ? ` (그중 ${uncertainCandidates}건은 DB 조회가 실패해 <행이 있는지 모른다>)`
        : ''),
    );
    deferredDeletes = stillGone.length;
    doomed.length = 0;
  }
  for (const filePath of doomed) {
    // 🔴 위 확인과 여기 사이에 시간이 흐른다 — getDocument 가 지연되는 동안 원자적
    //    rename 이 끝나 파일이 되살아날 수 있다(코덱스 9차 P2). 지우기 직전에 다시 본다.
    if (fileExistsExact(filePath, vaultPath)) continue;
    // 🔴 파일 하나가 두 행일 수 있다 — deleted 는 <행 수>가 아니라 <파일 수>다.
    // 🔴🔴 두 행을 <한 트랜잭션으로> 지운다. 하나씩 지우면 두 번째 실패가 <부분 삭제>를
    //    남기고, 그때는 deleted 를 세든 안 세든 보고가 거짓이 된다 — 코덱스가 10차에
    //    양쪽 다 지적했다("안 지웠다고 보고한다" / "지웠다는데 한 행이 남는다").
    //    부분 상태를 <만들지 않는 것>이 유일하게 참인 답이다.
    //
    // 🔴🔴 그런데 "여러 행" 을 <어떻게 찾느냐>가 오래 부족했다 (코덱스 15차 P2).
    //    `idsForRelPath` 는 <구분자>만 두 벌 만든다 — 대소문자 변형은 못 만든다.
    //    그래서 DB 에 `foo.md` 와 `Foo.md` 가 함께 있으면 한 행이 남는데도
    //    `deleted++` 가 "이 파일을 지웠다" 고 보고했다. 주석이 완전한 척한 셈이다.
    //    ★indexVault 는 이미 `pathCountKey` 로 묶어 지운다(위 4단계). 여기만 달랐다.
    //     같은 결함을 두 경로에 나눠 두면 한쪽만 고치고 끝난다 — 실제로 그랬다.
    let removedAny = false;
    try {
      const present: string[] = [];
      const seenId = new Set<string>();
      const wantKey = pathCountKey(relative(vaultPath, filePath));
      for (const id of idsForRelPath(relative(vaultPath, filePath))) {
        seenId.add(id);
        if (await store.getDocument(id)) present.push(id);
      }
      // 대소문자만 다른 행까지 <같은 트랜잭션으로> 데려온다.
      // ⚠️ `existingDocs` 는 이 실행 시작 시점의 스냅샷이다. 그 사이 생긴 행은 못 본다 —
      //    그것은 다음 실행이 잡는다(전체 색인은 어차피 전수를 본다).
      //
      // 🔴🔴 그 행의 <자기 파일이 정말 없는지> 따로 묻는다 (코덱스 16차 P1).
      //    `pathCountKey` 는 경로를 <소문자로 접는다>. Windows 에서는 그것이 곧
      //    "같은 파일" 이지만 <대소문자를 구분하는 파일시스템>에서는 `Foo.md` 와
      //    `foo.md` 가 <서로 다른 두 파일>이다. 접힌 키만 보고 지우면
      //    `Foo.md` 하나가 사라졌을 때 <살아 있는 `foo.md` 의 행까지> 함께 지운다.
      //    ★즉 15차에 "유실을 놓치지 않으려고" 넓힌 그물이 <멀쩡한 것을 잡는> 그물이
      //     될 수 있었다. 이 저장소의 사고 원형(정당한 규칙이 데이터를 날린다)과 같은 모양이다.
      //    → 접힌 키로 <후보>를 찾되, 지우는 것은 `fileExistsExact` 가 없다고 답한 것뿐이다.
      //      Windows 에서는 두 철자가 같은 파일을 가리키므로 이 검사가 결과를 안 바꾼다
      //      (그래서 15차가 고치려던 케이스는 그대로 고쳐진 채 남는다).
      for (const d of existingDocs) {
        if (seenId.has(d.id)) continue;
        if (pathCountKey(d.filePath) !== wantKey) continue;
        // ★경로 정규화는 `indexVault` 쪽과 <같은 식>을 쓴다. 옛 행은 구분자가
        //  역슬래시라, 그냥 이으면 비-Windows 에서 없는 파일로 보인다(= 삭제 허가).
        if (fileExistsExact(join(vaultPath, d.filePath.split(BACKSLASH).join('/')), vaultPath)) continue;
        seenId.add(d.id);
        present.push(d.id);
      }
      if (present.length > 0) {
        await store.deleteByDocumentIds(present);
        removedAny = true;
      }
    } catch (err) {
      failed++;
      failedFiles.push({ path: filePath, error: (err as Error)?.message ?? String(err) });
      console.error(errors.indexingFailed(filePath, err).format());
    }
    if (removedAny) deleted++;
  }

  return {
    indexed,
    skipped,
    deleted,
    deferredDeletes,
    failed,
    totalChunks,
    elapsedMs: Date.now() - start,
    totalFiles: uniquePaths.length,
    skippedFiles,
    failedFiles,
    // (여기 오면 소유는 확정됐다 — 미확인이면 위에서 이미 돌아갔다)
    ownershipUnverified: false,
  };
}
