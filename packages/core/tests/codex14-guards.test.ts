// 코덱스 14차에서 고친 것들을 <동작으로> 잰다.
//
// 🔴 이 파일이 존재하는 이유는 §9.3.3 이다: <고치는 것이 재는 것을 대신하지 못한다>.
//    지난 라운드에 변이 10건 중 5건이 살아남았고, 다섯 다 원인이 같았다 —
//    코드는 고쳤는데 그것을 재는 게이트를 안 붙였다. 그러면 다음 사람이 되돌려도 조용하다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, resolve as resolvePath } from 'node:path';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { indexVault, indexFiles, docIdForPath } from '../src/indexer/index.js';
import { summarizeIndexRun } from '../src/indexer/report.js';
import { reindexResponse } from '../src/api/server.js';
import { peekVaultOwner } from '../src/store/peek-owner.js';
import { VAULT_OWNER_KEY } from '../src/store/vault-ownership.js';
import type { IndexResult } from '../src/indexer/index.js';
import type { VectorStore } from '../src/store/types.js';
import type { Embedder } from '../src/indexer/embedder.js';

const DIMS = 4;
const embedder: Embedder = {
  modelName: 'test-mock',
  dimensions: DIMS,
  embed: async () => [0.1, 0.2, 0.3, 0.4],
  embedBatch: async (ts: string[]) => ts.map(() => [0.1, 0.2, 0.3, 0.4]),
};

let vault: string;
let store: VectorStore;

beforeEach(async () => {
  vault = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'vault14-'));
  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();
});
afterEach(async () => {
  await store.close();
  rmSync(vault, { recursive: true, force: true });
});

const write = (rel: string, body: string) => {
  const p = join(vault, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
  return p;
};
const BODY = '# t\n\n내용이 있다.';

const base: IndexResult = {
  indexed: 0, skipped: 0, deleted: 0, deferredDeletes: 0, failed: 0,
  totalChunks: 0, elapsedMs: 1, totalFiles: 0, skippedFiles: [], failedFiles: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// #7 — 요약이 <못 읽음>을 본다
// ═══════════════════════════════════════════════════════════════════════════
describe('요약은 <읽지도 못한 것>을 성공으로 세지 않는다 (코덱스 14차 P2)', () => {
  it('★ 한 장도 못 읽은 실행은 실패다 — `failed` 는 0 인데도', () => {
    const s = summarizeIndexRun({
      ...base,
      skippedFiles: [
        { path: 'a.md', reason: 'unreadable' },
        { path: 'b.md', reason: 'unreadable' },
      ] as IndexResult['skippedFiles'],
    });
    expect(s.ok).toBe(false);
    expect(s.kind).toBe('allFailed');
    expect(s.note).toContain('못 읽음 2');
  });

  it('★ <안정적인> 건너뜀은 실패가 아니다 — 빈 노트 3개짜리 볼트를 영구 실패로 만들지 않는다', () => {
    const s = summarizeIndexRun({
      ...base,
      skippedFiles: [
        { path: 'a.md', reason: 'empty' },
        { path: 'b.md', reason: 'too-large' },
      ] as IndexResult['skippedFiles'],
    });
    expect(s.ok).toBe(true);
    expect(s.note).toBe('');
  });

  it('못 읽은 것이 있어도 <성공한 것이 하나라도> 있으면 부분 성공이다', () => {
    const s = summarizeIndexRun({
      ...base, indexed: 3,
      skippedFiles: [{ path: 'a.md', reason: 'parse-error' }] as IndexResult['skippedFiles'],
    });
    expect(s.ok).toBe(true);
    expect(s.note).toContain('못 읽음 1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #8b — 응답이 <사유>를 싣는다
// ═══════════════════════════════════════════════════════════════════════════
describe('reindex 응답이 실패 <사유>를 싣는다 (코덱스 14차 P2)', () => {
  it('★ 남의 DB 면 note 로 그 사실이 나간다 — UI 가 보여줄 것이 있어야 한다', () => {
    const r = reindexResponse({ ...base, foreignDb: true });
    expect(r.success).toBe(false);
    expect(r.note).toContain('남의 DB');
  });

  it('정상 실행의 note 는 비어 있다 — 잡음을 만들지 않는다', () => {
    expect(reindexResponse({ ...base, indexed: 2 }).note).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #1 — 읽기 전용으로 먼저 묻는다
// ═══════════════════════════════════════════════════════════════════════════
describe('peekVaultOwner — DB 를 <바꾸지 않고> 각인을 읽는다 (코덱스 14차 P1)', () => {
  it('★ 없는 파일을 <만들지 않는다> — 이것이 깨지면 "안 썼다" 가 그 자리에서 거짓이 된다', () => {
    const missing = join(vault, 'nope.db');
    expect(peekVaultOwner(missing, VAULT_OWNER_KEY)).toBeUndefined();
    expect(existsSync(missing)).toBe(false);
  });

  it('★ 각인된 DB 의 각인을 그대로 읽는다', async () => {
    const dbPath = join(vault, 'real.db');
    const s = createSqliteVecStore(dbPath, DIMS);
    await s.initialize();
    s.setMeta(VAULT_OWNER_KEY, 'C:/some/vault');
    await s.close();

    expect(peekVaultOwner(dbPath, VAULT_OWNER_KEY)).toBe('C:/some/vault');
  });

  it('★ 각인이 <없는> DB 는 undefined 가 아니라 빈 문자열이다 — 못 읽은 것과 구별된다', async () => {
    const dbPath = join(vault, 'blank.db');
    const s = createSqliteVecStore(dbPath, DIMS);
    await s.initialize();
    await s.close();

    expect(peekVaultOwner(dbPath, VAULT_OWNER_KEY)).toBe('');
  });

  it('DB 가 아닌 파일은 <모른다>고 답한다 — 던지지 않는다', () => {
    const junk = join(vault, 'junk.db');
    writeFileSync(junk, 'not a database at all', 'utf-8');
    expect(peekVaultOwner(junk, VAULT_OWNER_KEY)).toBeUndefined();
  });

  // 🔴 이 describe 의 제목이 <바꾸지 않고> 라고 약속하는데, 오랫동안 그것을 <재는 줄이
  //    하나도 없었다>. 없는 파일을 안 만드는 것만 쟀지, <있는 파일이 그대로인지>는 안 쟀다.
  //    ★제목에 적힌 약속은 시험이 아니다 (§9.3.3).
  it('★★ 각인을 읽어도 DB 바이트가 <그대로다> — 이 함수가 존재하는 이유 자체', async () => {
    const dbPath = join(vault, 'untouched.db');
    const s = createSqliteVecStore(dbPath, DIMS);
    await s.initialize();
    s.setMeta(VAULT_OWNER_KEY, 'C:/some/vault');
    await s.close();

    const before = createHash('sha256').update(readFileSync(dbPath)).digest('hex');
    expect(peekVaultOwner(dbPath, VAULT_OWNER_KEY)).toBe('C:/some/vault');
    const after = createHash('sha256').update(readFileSync(dbPath)).digest('hex');

    expect(after).toBe(before);
  });

  // ⚠️ 위 시험이 덮지 <않는> 것을 여기 적어 둔다 — 라이브 실측(2026-08-22)에서 알았다.
  //    WAL 모드 DB 는 읽기 전용 연결도 옆에 `-shm`·`-wal` 을 <만든다>. 그래서 약속은
  //    "파일을 안 만든다" 가 아니라 <"DB 내용을 안 바꾼다">여야 한다. 이 시험이 재는 것도
  //    그쪽이다(`.db` 해시). 사이드카까지 금지로 적으면 <지킬 수 없는 약속>이 된다.
  it('사이드카(-wal/-shm)는 생길 수 있다 — 막으려던 것은 그것이 아니다', async () => {
    const dbPath = join(vault, 'sidecar.db');
    const s = createSqliteVecStore(dbPath, DIMS);
    await s.initialize();
    s.setMeta(VAULT_OWNER_KEY, 'C:/some/vault');
    await s.close();

    const before = createHash('sha256').update(readFileSync(dbPath)).digest('hex');
    peekVaultOwner(dbPath, VAULT_OWNER_KEY);

    // 사이드카가 생겼든 아니든 <내용>은 같아야 한다. 그것만이 판정선이다.
    expect(createHash('sha256').update(readFileSync(dbPath)).digest('hex')).toBe(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #3 — 팩만 든 DB 도 배치 색인이 가져가지 못한다
// ═══════════════════════════════════════════════════════════════════════════
describe('배치 색인은 <문서가 하나라도 있으면> 각인하지 않는다 (코덱스 14차 P1)', () => {
  it('★ 팩만 든 DB 를 배치 색인이 <탈취하지 않는다>', async () => {
    // 팩 문서는 경로 해시가 아닌 id 를 쓴다 — 옛 판정(`ownedByFileIndex`)은 이것을 0 으로 셌다.
    await store.upsertDocument({
      id: 'pack_demo_1', filePath: '[pack] demo.md', title: 'demo',
      content: '팩에서 온 문서', frontmatter: {}, tags: [],
      lastModified: new Date().toISOString(), contentHash: 'h1',
    });

    const p = write('new.md', BODY);
    const r = await indexFiles(vault, [p], { store, embedder });

    expect(r.ownershipUnverified).toBe(true);
    expect(r.indexed).toBe(0);
    // 🔴 각인도 안 남는다 — 남으면 <다음 실행이 그 각인을 증거로> 진행한다.
    expect(store.getMeta(VAULT_OWNER_KEY) ?? '').toBe('');
    // 팩 문서는 그대로다.
    expect((await store.getAllDocuments()).length).toBe(1);
  });

  it('★ 그래도 <완전히 빈> DB 면 배치가 스스로 각인한다 — 가드가 전부를 막지 않는다', async () => {
    const p = write('first.md', BODY);
    const r = await indexFiles(vault, [p], { store, embedder });

    expect(r.ownershipUnverified).toBeFalsy();
    expect(r.indexed).toBe(1);
    expect(store.getMeta(VAULT_OWNER_KEY)).toBe(resolvePath(vault));
  });

  it('★ 그리고 전체 색인은 그 팩 전용 DB 를 <가져갈 수 있다> — 이관 경로가 막히면 안 된다', async () => {
    await store.upsertDocument({
      id: 'pack_demo_1', filePath: '[pack] demo.md', title: 'demo',
      content: '팩에서 온 문서', frontmatter: {}, tags: [],
      lastModified: new Date().toISOString(), contentHash: 'h1',
    });
    write('a.md', BODY);

    const r = await indexVault(vault, { store, embedder });
    expect(r.ownershipUnverified).toBeFalsy();
    expect(store.getMeta(VAULT_OWNER_KEY)).toBe(resolvePath(vault));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #10 — 불확실 계수도 같은 필터를 통과한다
// ═══════════════════════════════════════════════════════════════════════════
describe('<모른다>고 센 수도 미룬 삭제와 같은 필터를 통과한다 (코덱스 14차 P2)', () => {
  it('★ 되살아난 후보는 미룬 수에서도, 불확실 수에서도 함께 빠진다', async () => {
    const keep = write('keep.md', BODY);
    const ghost = write('ghost.md', BODY);
    await indexVault(vault, { store, embedder });

    rmSync(ghost);
    // 🔴 keep.md 를 <바꾼다>. 안 바꾸면 해시가 같아 SKIP 되고 임베더가 아예 안 불려
    //     이 되어 <연기 경로에 들어가지 않는다>. 처음 이것을 빠뜨려
    //    시험이 아무것도 안 재고 초록이었다.
    writeFileSync(keep, BODY + String.fromCharCode(10) + '내용을 바꾼다', 'utf-8');

    // 조회가 <터지면서> 그 파일을 되살린다. 이 순서가 핵심이다:
    //   doomed 에는 (파일이 없으므로) 담기고, 그 뒤 stillGone 필터에서는 (되살아났으므로) 빠진다.
    //   옛 코드는 담을 때 센 수를 그대로 보고해 "삭제 0건을 미룬다, 그중 1건은 조회 실패" 가 됐다.
    const logs: string[] = [];
    const spy = console.error;
    console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };

    // 🔴 <ghost 의 조회에서만> 터뜨린다. 처음엔 모든 getDocument 를 가로챘는데,
    //    색인 단계의 첫 호출에서 이미 파일이 되살아나 삭제 후보 자체가 사라졌다 —
    //    그래서 연기 경로에 <한 번도 안 들어가고> 시험이 초록이었다.
    //    ★변이 M7 이 그 사실을 드러냈다: 아무것도 안 재는 시험은 어떤 변이도 못 잡는다.
    const ghostId = docIdForPath(vault, ghost);
    const throwingStore = new Proxy(store, {
      get(t, k, rcv) {
        if (k === 'getDocument') {
          return async (id: string) => {
            if (id !== ghostId) return (t as VectorStore).getDocument(id);
            writeFileSync(ghost, BODY, 'utf-8');   // 저장이 끝나 <되살아난> 상황
            throw new Error('조회 폭발');
          };
        }
        return Reflect.get(t, k, rcv);
      },
    }) as VectorStore;

    try {
      // 실패를 하나 만들어 <연기 경로>로 들어가게 한다.
      const failing: Embedder = {
        ...embedder,
        embedBatch: async () => { throw new Error('embedder down'); },
      };
      await indexFiles(vault, [keep, ghost], { store: throwingStore, embedder: failing });
    } finally {
      console.error = spy;
    }

    // 🔴 '삭제' 로 찾으면 안 된다 — `삭제 후보 조회 실패 (...)` 로그가 <먼저> 걸린다.
    //    실제로 그것 때문에 변이 M7 이 살아남았다: 엉뚱한 줄을 재고 있었다.
    //    ★"시험이 초록" 과 "시험이 그것을 재고 있다" 는 다르다. 변이가 그 차이를 드러냈다.
    const line = logs.find(l => l.includes('미룬다')) ?? '';
    expect(line, '연기 경로에 들어가지 못했다 — 시험이 성립하지 않는다').not.toBe('');
    // 🔴 미룬 수가 0 이면 <불확실 수도 안 찍혀야> 한다. 두 수가 같은 집합을 세기 때문이다.
    if (line.includes('삭제 0건을 미룬다')) {
      expect(line).not.toContain('조회가 실패해');
    }
    // 어느 쪽이든 <불확실 수 > 미룬 수> 는 성립할 수 없다.
    const deferred = Number(/삭제 (\d+)건을 미룬다/.exec(line)?.[1] ?? '0');
    const uncertain = Number(/\(그중 (\d+)건은/.exec(line)?.[1] ?? '0');
    expect(uncertain).toBeLessThanOrEqual(deferred);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 코덱스 15차 #7 — 배치 삭제가 <대소문자 변형 행>을 남기면서 "지웠다"고 센다
// ═══════════════════════════════════════════════════════════════════════════
describe('배치 삭제는 같은 파일의 <모든 행>을 지운다 (코덱스 15차 P2)', () => {
  it('★ 대소문자만 다른 행도 함께 지운다 — 하나 남기고 "1건 삭제" 는 거짓 보고다', async () => {
    const p = write('Note.md', BODY);
    await indexVault(vault, { store, embedder });
    expect((await store.getAllDocuments()).length).toBe(1);

    // 대소문자만 다른 <옛 행>을 심는다. `idsForRelPath` 는 이 id 를 만들지 못한다 —
    // 구분자만 두 벌 만들 뿐 대소문자 변형은 안 만든다. 그래서 옛 코드는 이 행을 놓쳤다.
    await store.upsertDocument({
      id: docIdForPath(vault, join(vault, 'note.md')), filePath: 'note.md', title: 'note',
      content: '옛 대소문자 행', frontmatter: {}, tags: [],
      lastModified: new Date().toISOString(), contentHash: 'old',
    });
    expect((await store.getAllDocuments()).length).toBe(2);

    rmSync(p);
    const r = await indexFiles(vault, [p], { store, embedder });

    expect(r.deleted).toBe(1);
    // 🔴 여기가 핵심이다. 옛 코드는 <행 하나를 남긴 채> deleted=1 을 보고했다.
    expect((await store.getAllDocuments()).length).toBe(0);
  });

  // 🔴🔴 그런데 위 처방이 <반대 방향으로> 지나칠 수 있었다 (코덱스 16차 P1).
  //    `pathCountKey` 는 경로를 소문자로 접는다. 그것이 "같은 파일" 인 것은
  //    <대소문자를 무시하는> 파일시스템에서만 참이다. 구분하는 곳에서는
  //    `Foo.md` 와 `foo.md` 가 서로 다른 두 파일이고, 하나가 지워졌다고
  //    <살아 있는 다른 하나의 행까지> 지우면 그것이 바로 이 사고의 재현이다.
  //    → 접힌 키로 <후보>만 찾고, 지우는 것은 파일이 정말 없는 행뿐이어야 한다.
  it('★★ 파일이 <살아 있는> 대소문자 형제의 행은 지우지 않는다', async () => {
    const alive = write('Keep.md', BODY);      // 이 파일은 디스크에 <남는다>
    await indexVault(vault, { store, embedder });
    expect((await store.getAllDocuments()).length).toBe(1);

    // 접힌 키가 같은 <다른 철자>의 행. 그 파일은 디스크에 없다.
    const goneAbs = join(vault, 'keep.md');
    await store.upsertDocument({
      id: docIdForPath(vault, goneAbs), filePath: 'keep.md', title: 'keep',
      content: '없는 파일의 행', frontmatter: {}, tags: [],
      lastModified: new Date().toISOString(), contentHash: 'gone',
    });
    expect((await store.getAllDocuments()).length).toBe(2);

    // 없는 쪽을 색인 대상으로 준다 → 그 행만 사라져야 한다.
    await indexFiles(vault, [goneAbs], { store, embedder });

    const left = (await store.getAllDocuments()).map(d => d.filePath).sort();
    // 🔴 살아 있는 파일의 행이 남아야 한다. 접힌 키만 보고 지우면 여기서 0건이 된다.
    //    ⚠️ 대소문자를 <무시하는> 파일시스템(Windows)에서는 두 철자가 같은 파일을
    //       가리키므로 `Keep.md` 가 존재한다 → 어느 쪽도 안 지워진다. 그래서
    //       "지워진 것이 없거나, 없는 쪽만 지워졌거나" 둘 다 통과로 본다.
    //       ★핵심은 <살아 있는 파일의 행이 남는 것>이고, 그것은 두 OS 모두에서 참이다.
    expect(left, `살아 있는 파일의 행이 사라졌다: ${JSON.stringify(left)}`).toContain('Keep.md');
    expect(existsSync(alive)).toBe(true);
  });
});
