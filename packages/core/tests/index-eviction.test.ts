// 🔴 색인 축출 회귀.
//
// scanVault 는 읽기·파싱에 실패한 파일을 documents 가 아니라 skipped 로 돌린다.
// indexVault 의 4단계("삭제된 파일 처리")가 scannedIds 를 documents 로만 만들면,
// <디스크에 멀쩡히 있는데 한 번 못 읽은> 문서가 색인에서 통째로 축출된다.
// 실측 2026-08-20: 한 번의 index 실행이 이 경로로 문서 128개를 지웠다.
//
// 삭제는 되돌릴 수 없는 쪽이라, 애매하면 남기는 것이 옳다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, symlinkSync, chmodSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { createHash } from 'node:crypto';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { indexVault, indexFiles, docIdForPath } from '../src/indexer/index.js';
import { VAULT_OWNER_KEY } from '../src/store/vault-ownership.js';
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
  vault = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'vault-'));
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
const run = () => indexVault(vault, { store, embedder });

describe('indexVault — 삭제 판정', () => {
  it('진짜로 지워진 파일은 색인에서도 지운다', async () => {
    write('keep.md', BODY);
    const goneP = write('gone.md', BODY);
    await run();
    expect((await store.getAllDocuments()).length).toBe(2);

    rmSync(goneP);
    const r = await run();
    expect(r.deleted).toBe(1);
    const left = (await store.getAllDocuments()).map(d => d.filePath);
    expect(left).toEqual(['keep.md']);
  });

  it('★ 회귀: <못 읽은> 파일을 지워진 것으로 오인해 축출하지 않는다', async () => {
    write('keep.md', BODY);
    const flaky = write('flaky.md', BODY);
    await run();
    const id = docIdForPath(vault, flaky);
    expect((await store.getAllDocuments()).some(d => d.id === id)).toBe(true);

    // 파일은 <있는데> 스캐너가 건너뛰는 상태로 만든다 (0바이트 → reason 'empty').
    writeFileSync(flaky, '', 'utf-8');
    const r = await run();

    expect(r.deleted).toBe(0);                                  // 아무것도 안 지워야 한다
    expect(r.skippedFiles.length).toBeGreaterThan(0);           // 건너뛴 건 맞다
    const ids = (await store.getAllDocuments()).map(d => d.id);
    expect(ids).toContain(id);                                  // 색인에 남아 있어야 한다
  });

  it('★ 회귀: 프론트매터만 있어 본문이 빈 파일도 축출하지 않는다', async () => {
    write('keep.md', BODY);
    const fm = write('fmonly.md', BODY);
    await run();
    const id = docIdForPath(vault, fm);

    writeFileSync(fm, '---\ntitle: x\n---\n\n   \n', 'utf-8');   // 본문 없음 → skipped
    const r = await run();

    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).map(d => d.id)).toContain(id);
  });

  it('★ 회귀: <empty> 말고 다른 사유로 건너뛴 파일도 축출하지 않는다', async () => {
    // 앞의 두 시험이 둘 다 empty 라, "empty 만 보호한다" 는 변이가 통과했다
    // (코덱스 P2, 2026-08-21). 사유가 다른 것을 하나 넣어 그 구멍을 막는다.
    write('keep.md', BODY);
    const big = write('big.md', BODY);
    await run();
    const id = docIdForPath(vault, big);

    writeFileSync(big, 'x'.repeat(5 * 1024 * 1024 + 16), 'utf-8');   // > 5MB → 'too-large'
    const r = await run();

    expect(r.skippedFiles.some(s => s.reason === 'too-large')).toBe(true);
    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).map(d => d.id)).toContain(id);
  });

  it('★ 회귀: <이 볼트의 파일이 아닌> 문서(pack import)를 지우지 않는다', async () => {
    // importPack 은 id `pack_<name>` / filePath `[pack] <name>` 을 같은 저장소에 넣는다.
    // 디스크에 없으므로, 소유를 안 가리면 다음 색인이 통째로 지운다 (코덱스 P1, 2026-08-21).
    write('keep.md', BODY);
    await store.upsertDocument({
      id: 'pack_demo',
      filePath: '[pack] demo',
      title: 'demo (Knowledge Pack)',
      content: 'Imported pack: demo',
      frontmatter: { pack: 'demo' },
      tags: [],
      lastModified: new Date(0).toISOString(),
      contentHash: 'pack_demo_1',
    });

    const r = await run();

    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).map(d => d.id)).toContain('pack_demo');
  });

  it('건너뛴 파일이 <나중에 지워지면> 그때는 지운다', async () => {
    write('keep.md', BODY);
    const flaky = write('flaky.md', BODY);
    await run();

    writeFileSync(flaky, '', 'utf-8');
    expect((await run()).deleted).toBe(0);

    rmSync(flaky);
    expect((await run()).deleted).toBe(1);
    expect((await store.getAllDocuments()).map(d => d.filePath)).toEqual(['keep.md']);
  });
});

// indexFiles(watcher 경로) — 없어졌다고 <즉시> 지우지 않는다.
describe('indexFiles — 원자적 저장의 틈', () => {
  it('★ 회귀: 배치 도중 되살아난 파일은 지우지 않는다', async () => {
    const gone = write('atomic.md', BODY);
    const other = write('other.md', BODY);
    await indexVault(vault, { store, embedder });
    const id = docIdForPath(vault, gone);

    rmSync(gone);   // unlink → rename 의 <중간> 상태를 흉내낸다
    writeFileSync(other, '# other\n\n바뀌었다.', 'utf-8');   // 재색인을 강제 (해시 변경)

    // other.md 를 임베딩하는 동안 파일이 되돌아온다 = rename 완료.
    const reviving: Embedder = {
      ...embedder,
      embedBatch: async (ts: string[]) => {
        writeFileSync(gone, '# atomic\n\n돌아왔다.', 'utf-8');
        return ts.map(() => [0.1, 0.2, 0.3, 0.4]);
      },
    };
    const r = await indexFiles(vault, [gone, other], { store, embedder: reviving });

    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).map(d => d.id)).toContain(id);
  });

  it('★ 회귀: 배치가 <끝난 뒤> 안정화 창 안에 되살아나도 지우지 않는다', async () => {
    // 배치에 unlink 하나만 들면 첫 검사 바로 다음 줄에서 재확인하게 되어
    // 안정화 시간이 0 이다 — rename 이 다음 tick 에 끝나면 그대로 지운다
    // (코덱스 2차 P2, 2026-08-21). 대기가 있어야 이 시험이 통과한다.
    const gone = write('settle.md', BODY);
    await indexVault(vault, { store, embedder });
    const id = docIdForPath(vault, gone);

    rmSync(gone);
    const t = setTimeout(() => writeFileSync(gone, '# settle\n\n돌아왔다.', 'utf-8'), 20);
    const r = await indexFiles(vault, [gone], { store, embedder });
    clearTimeout(t);

    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).map(d => d.id)).toContain(id);
  });

  it('진짜로 사라진 채로 끝나면 지운다 (판별력 확인)', async () => {
    const gone = write('atomic2.md', BODY);
    await indexVault(vault, { store, embedder });
    const id = docIdForPath(vault, gone);

    rmSync(gone);
    const r = await indexFiles(vault, [gone], { store, embedder });

    expect(r.deleted).toBe(1);
    expect((await store.getAllDocuments()).map(d => d.id)).not.toContain(id);
  });
});

// 🔴 API ingest 가 남긴 <옛 형식> 문서 (코덱스 2·3·4차, 2026-08-21).
//
// ingest 는 join() 결과(윈도우에서 역슬래시)를 id 에도 file_path 에도 그대로 쓴다.
// 파일 스캐너는 같은 파일을 슬래시로 정규화해 다른 id·다른 file_path 로 쓴다.
// 그래서 ① UNIQUE(file_path) 가 안 걸려 두 행이 공존하고 ② 한쪽만 아는 코드가
// 남은 쪽을 "못 본 문서" 로 오인해 지우거나, 영원히 안 지워 stale 로 남긴다.
//
// ★역슬래시를 host 의 path.sep 으로 만들지 않는다 — 리눅스 CI 에서 sep 이 '/' 라
//  정본과 같아져 시험이 조용히 무의미해지거나 깨진다(4차 P1 실측).
const BS = String.fromCharCode(92);
const legacyId = (rel: string) =>
  createHash('sha256').update(rel.split('/').join(BS)).digest('hex').slice(0, 16);
const legacyPath = (rel: string) => rel.split('/').join(BS);

describe('옛 형식(역슬래시) ingest 문서', () => {
  const REL = '00_Inbox/ingested.md';

  const putLegacy = () => store.upsertDocument({
    id: legacyId(REL), filePath: legacyPath(REL), title: 'ingested', content: '본문',
    frontmatter: {}, tags: [], lastModified: new Date(0).toISOString(), contentHash: 'ingest-1',
  });

  it('두 유도가 실제로 다르다 (시험이 무의미해지지 않게)', () => {
    expect(legacyId(REL)).not.toBe(docIdForPath(vault, join(vault, REL)));
    expect(legacyPath(REL)).not.toBe(REL);
  });

  it('★ 회귀: 파일이 <있는데 건너뛴> 경우 지우지 않는다', async () => {
    write('keep.md', BODY);
    write(REL, BODY);
    await putLegacy();
    writeFileSync(join(vault, REL), '', 'utf-8');            // 0바이트 → skipped

    const r = await run();

    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).map(d => d.id)).toContain(legacyId(REL));
  });

  it('★ 회귀: 정상 색인되면 옛 행은 <치워지고> deleted 는 안 올라간다', async () => {
    write('keep.md', BODY);
    write(REL, BODY);                                        // 정상 스캔된다
    await putLegacy();
    expect((await store.getAllDocuments()).length).toBe(1);

    const r = await run();

    const left = (await store.getAllDocuments());
    expect(left.map(d => d.id)).not.toContain(legacyId(REL));           // 중복이 사라졌다
    expect(left.map(d => d.id)).toContain(docIdForPath(vault, join(vault, REL)));
    expect(left.length).toBe(2);                                        // keep + 정본
    expect(r.deleted).toBe(0);                    // 중복 정리는 <파일 삭제>가 아니다
  });

  it('★ 회귀: 내용이 안 바뀐 문서에 붙은 옛 행도 치운다', async () => {
    write('keep.md', BODY);
    write(REL, BODY);
    await run();                                             // 정본 행을 만든다
    await putLegacy();                                       // 그 뒤 옛 행이 끼어든다
    expect((await store.getAllDocuments()).length).toBe(3);

    const r = await run();                                   // 이번엔 전부 Unchanged 다

    expect((await store.getAllDocuments()).map(d => d.id)).not.toContain(legacyId(REL));
    expect(r.deleted).toBe(0);
  });

  it('★ 회귀: indexFiles 의 unlink 는 <두 행 모두> 지운다', async () => {
    const abs = write(REL, BODY);
    await run();                                             // 정본 행
    await putLegacy();                                       // 옛 행도 함께 둔다
    expect((await store.getAllDocuments()).length).toBe(2);

    rmSync(abs);
    await indexFiles(vault, [abs], { store, embedder });

    expect((await store.getAllDocuments()).length).toBe(0);
  });

  it('★ 회귀: indexFiles 의 add/change 도 옛 행을 치운다 — <각인된 뒤에>', async () => {
    // 🔴 정리는 "같은 파일의 중복" 판정 위에 서 있고, 그 판정은 <이 DB 가 이 볼트의
    //    것>이라는 전제를 쓴다. 미각인이면 그 전제가 없다.
    // 🔴🔴 한때 여기서 "정리만 건너뛰고 색인은 한다" 로 절충했다 → <틀렸다>(12차 P1):
    //    그렇게 쓴 문서가 다음 전체 색인의 <소유 증거>가 되어 가드가 1회용이 됐다.
    //    지금은 파일 문서가 이미 있는 미각인 DB 면 <배치가 아무것도 하지 않는다>.
    const abs = write(REL, BODY);
    await putLegacy();                                        // 파일 색인이 소유한 모양의 행

    const first = await indexFiles(vault, [abs], { store, embedder });   // 아직 미각인이다

    expect(first.ownershipUnverified).toBe(true);
    expect(first.indexed).toBe(0);                            // 넣지도 않는다
    expect((await store.getAllDocuments()).map(d => d.id)).toEqual([legacyId(REL)]);

    store.setMeta(VAULT_OWNER_KEY, resolvePath(vault));       // 각인됐다
    await indexFiles(vault, [abs], { store, embedder });

    const left = (await store.getAllDocuments()).map(d => d.id);
    expect(left).toEqual([docIdForPath(vault, abs)]);         // 이제 치운다
  });
});

// 🔴 코덱스 5차 (2026-08-21) — <중복 정리>가 스스로 유실을 만들던 자리 셋.
//
// 이 파일이 고치려던 결함(문서 축출)을, 그 수정에 딸려 온 정리 코드가
// 세 가지 방식으로 다시 만들고 있었다:
//   ① 재색인이 실패하면 정본이 안 써지는데 옛 행은 지웠다 → 문서가 통째로 사라진다
//   ② indexFiles 의 unchanged 분기가 정리를 건너뛴다 → 두 행이 영원히 남는다
//   ③ deleted 가 <행 수>를 세서 파일 1개 삭제가 2로 보고된다 → 이 세션이 128 이라는
//      수를 쫓느라 하루를 썼다. 그 수가 오염되면 다음 사람이 같은 길을 간다.
describe('중복 정리가 유실을 만들지 않는다 (코덱스 5차)', () => {
  const REL = '00_Inbox/ingested.md';
  const putLegacy = () => store.upsertDocument({
    id: legacyId(REL), filePath: legacyPath(REL), title: 'ingested', content: '본문',
    frontmatter: {}, tags: [], lastModified: new Date(0).toISOString(), contentHash: 'ingest-1',
  });

  /** 임베더가 죽은 상태 (Ollama 중지 등) — 실제로 가장 흔한 실패다. */
  const deadEmbedder: Embedder = {
    modelName: 'test-dead', dimensions: DIMS,
    embed: async () => { throw new Error('embedder down'); },
    embedBatch: async () => { throw new Error('embedder down'); },
  };

  it('★ 회귀: 재색인이 <실패>하면 옛 행을 지우지 않는다 (P1)', async () => {
    write(REL, BODY);
    await putLegacy();

    const r = await indexVault(vault, { store, embedder: deadEmbedder });

    expect(r.failed).toBe(1);
    expect(r.indexed).toBe(0);
    // 정본은 못 썼다. 그런데 옛 행까지 지우면 <문서가 사라진다> — 그게 이 파일의 주제다.
    const left = (await store.getAllDocuments()).map(d => d.id);
    expect(left).toContain(legacyId(REL));
  }, 15_000);

  it('★ 회귀: 청크 저장이 <중간에> 실패해도 옛 행을 지우지 않는다 (P1)', async () => {
    // 🔴 임베더 실패는 upsertDocument <앞에서> 죽어 정리 코드에 닿지도 않는다.
    //    그래서 그 시험만으로는 "정리를 upsertChunks 뒤에 두었다" 를 재지 못한다 —
    //    변이 M1(정리를 upsertChunks 앞으로)이 살아남아 그 구멍을 드러냈다.
    //    여기서는 정본 <문서 행은 써졌지만 청크가 없는> 상태를 만든다:
    //    그 문서는 검색되지 않으므로, 청크가 살아 있는 옛 행을 지우면 유실이다.
    write(REL, BODY);
    await putLegacy();
    const halfDead: VectorStore = {
      ...store,
      replaceDocument: async () => { throw new Error('disk full'); },
    };

    const r = await indexVault(vault, { store: halfDead, embedder });

    expect(r.failed).toBe(1);
    expect((await store.getAllDocuments()).map(d => d.id)).toContain(legacyId(REL));
  });

  it('★ 회귀: 청크 쓰기가 실패하면 <옛 문서와 옛 청크가 그대로> 남는다 (6a P1)', async () => {
    // 🔴 실측 2026-08-21: upsertDocument 의 INSERT OR REPLACE 가 FK cascade 로
    //    기존 청크를 먼저 날린다(검색 1건 → 0건). 그래서 문서와 청크를 <따로> 쓰면
    //    그 사이의 실패가 "행은 있는데 검색이 안 되는" 문서를 만든다.
    //    한 트랜잭션이면 통째로 되돌아가 <옛 내용이 계속 검색된다>.
    const abs = write('doc.md', `# t

첫번째내용이있다.`);
    await run();
    const id = docIdForPath(vault, abs);
    expect(await store.searchKeyword('첫번째내용이있다', 10)).toHaveLength(1);

    // 청크 쓰기만 실패하는 상황: 임베딩 차원을 틀리게 준다 (vec0 가 거부한다).
    await expect(store.replaceDocument(
      { id, filePath: 'doc.md', title: 't', content: '두번째내용이있다.',
        frontmatter: {}, tags: [], lastModified: new Date().toISOString(), contentHash: 'h2' },
      [{ id: id + '#0', documentId: id, content: '두번째내용이있다.',
         startLine: 0, endLine: 0, tokenCount: 1, embedding: [1, 2] } as never],
    )).rejects.toThrow();

    // 되돌아갔다 — 청크 0 개인 문서가 되지 않았고 옛 내용이 그대로 검색된다.
    expect(await store.searchKeyword('첫번째내용이있다', 10)).toHaveLength(1);
    expect((await store.getDocument(id))?.content).toContain('첫번째내용이있다');
  });

  it('★ 회귀: indexFiles 의 unchanged 분기도 옛 행을 치운다 (P1)', async () => {
    const abs = write(REL, BODY);
    await indexFiles(vault, [abs], { store, embedder });      // 정본을 만든다
    await putLegacy();                                        // 그 뒤 옛 행이 끼어든다
    store.setMeta(VAULT_OWNER_KEY, resolvePath(vault));       // 각인돼야 정리한다(11차 P1)
    expect((await store.getAllDocuments()).length).toBe(2);

    const r = await indexFiles(vault, [abs], { store, embedder });   // 내용은 그대로다

    expect(r.skipped).toBe(1);                                // unchanged 경로를 탔다
    expect((await store.getAllDocuments()).map(d => d.id)).toEqual([docIdForPath(vault, abs)]);
  });

  it('★ 회귀: 미각인이면 <분기에 닿기도 전에> 돌아간다 — 옛 행이 남는다', async () => {
    const abs = write(REL, BODY);
    await indexFiles(vault, [abs], { store, embedder });
    await putLegacy();
    store.setMeta(VAULT_OWNER_KEY, '');                       // 미각인으로 되돌린다

    const r = await indexFiles(vault, [abs], { store, embedder });

    expect(r.ownershipUnverified).toBe(true);                 // 그 사실을 <보고한다>
    // 🔴 skipped 조차 0 이다 — unchanged 분기까지 <가지 않는다>.
    //    한때 여기 1 이었고, 그 1 이 "루프를 돌긴 했다" 는 뜻이었다.
    expect(r.skipped).toBe(0);
    expect(r.indexed).toBe(0);
    expect((await store.getAllDocuments()).length).toBe(2);   // 남의 것일 수 있어 남긴다
  });

  it('★ 회귀: indexFiles — 두 행짜리 파일 하나를 지우면 deleted 는 1 이다 (P2)', async () => {
    const abs = write(REL, BODY);
    await run();
    await putLegacy();
    expect((await store.getAllDocuments()).length).toBe(2);

    rmSync(abs);
    const r = await indexFiles(vault, [abs], { store, embedder });

    expect(r.deleted).toBe(1);                                // 파일 수지 행 수가 아니다
    expect((await store.getAllDocuments()).length).toBe(0);
  });

  it('★ 회귀: indexVault — 두 행짜리 파일 하나를 지우면 deleted 는 1 이다 (P2)', async () => {
    const abs = write(REL, BODY);
    write('keep.md', BODY);
    await run();
    await putLegacy();

    rmSync(abs);
    const r = await run();

    expect(r.deleted).toBe(1);
    expect((await store.getAllDocuments()).map(d => d.filePath)).toEqual(['keep.md']);
  });
});

// 🔴 코덱스 6a (2026-08-21) — 삭제가 <실패와 겹칠 때> 문서를 잃는 자리.
describe('삭제는 실패·부활과 겹쳐도 문서를 잃지 않는다 (코덱스 6a)', () => {
  const deadEmbedder: Embedder = {
    modelName: 'test-dead', dimensions: DIMS,
    embed: async () => { throw new Error('embedder down'); },
    embedBatch: async () => { throw new Error('embedder down'); },
  };

  it('★ 회귀: rename + 임베더 다운 → 문서가 <통째로> 사라지지 않는다 (P1)', async () => {
    const oldAbs = write('old.md', BODY);
    await run();
    expect((await store.getAllDocuments()).length).toBe(1);

    // old.md → new.md 로 rename. 새 경로는 임베더가 죽어 색인 실패한다.
    rmSync(oldAbs);
    write('new.md', BODY);
    const r = await indexVault(vault, { store, embedder: deadEmbedder });

    expect(r.failed).toBe(1);
    // 옛 행을 지웠다면 색인에 아무것도 안 남는다 — 그게 유실이다.
    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).length).toBe(1);
  }, 15_000);

  it('★ 회귀: 스캔 뒤 <되살아난> 파일은 지우지 않는다 (P1)', async () => {
    const abs = write('a.md', BODY);
    write('keep.md', BODY);
    await run();

    // 스캔 시점엔 없다가, 삭제 판정 직전에 되돌아온다.
    rmSync(abs);
    const r = await indexVault(vault, {
      store, embedder,
      onProgress: () => { if (!existsSync(abs)) writeFileSync(abs, BODY, 'utf-8'); },
    });

    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).length).toBe(2);
  });

  it('실패가 없으면 삭제는 <평소대로> 일어난다 (연기 규칙이 전부를 막지 않는다)', async () => {
    const abs = write('gone.md', BODY);
    write('keep.md', BODY);
    await run();

    rmSync(abs);
    const r = await run();

    expect(r.failed).toBe(0);
    expect(r.deleted).toBe(1);
    expect((await store.getAllDocuments()).map(d => d.filePath)).toEqual(['keep.md']);
  });

  it('★ 회귀: indexFiles — 실패가 있으면 unlink 삭제도 미룬다 (P1)', async () => {
    const goneAbs = write('gone.md', BODY);
    await run();                                   // gone.md 만 색인돼 있다
    rmSync(goneAbs);
    const newAbs = write('fresh.md', BODY);        // rename 의 <새 이름> — 아직 색인 전이다

    const r = await indexFiles(vault, [goneAbs, newAbs], { store, embedder: deadEmbedder });

    expect(r.failed).toBe(1);                      // 새 이름이 임베딩에 실패했다
    expect(r.deleted).toBe(0);                     // 그러니 옛 이름도 아직 안 지운다
    expect((await store.getAllDocuments()).map(d => d.filePath)).toEqual(['gone.md']);
  }, 15_000);
});

// 🔴 코덱스 6a P2 — 정리 실패가 색인을 무너뜨리거나 계수를 속이던 자리.
describe('정리 실패 격리와 계수 정의 (코덱스 6a P2)', () => {
  const REL = '00_Inbox/ingested.md';
  const putLegacy = () => store.upsertDocument({
    id: legacyId(REL), filePath: legacyPath(REL), title: 'ingested', content: '본문',
    frontmatter: {}, tags: [], lastModified: new Date(0).toISOString(), contentHash: 'ingest-1',
  });
  /** 옛 형식 id 를 지울 때만 던지는 store. 정본 삭제는 정상 동작한다. */
  const brittle = (): VectorStore => ({
    ...store,
    deleteByDocumentId: async (id: string) => {
      if (id === legacyId(REL)) throw new Error('delete failed');
      return store.deleteByDocumentId(id);
    },
  });

  it('★ 회귀: 옛 행 정리가 실패해도 <색인은 성공>으로 집계된다 (changed 경로)', async () => {
    const abs = write(REL, BODY);
    await putLegacy();
    // 🔴 각인을 먼저 세운다. 안 그러면 <소유 미확인>에 걸려 배치가 아무것도 하지 않고,
    //    이 시험이 재려던 "정리 실패 격리" 에 닿지도 못한 채 초록이 된다 (12차).
    store.setMeta(VAULT_OWNER_KEY, resolvePath(vault));

    const r = await indexFiles(vault, [abs], { store: brittle(), embedder });

    expect(r.indexed).toBe(1);
    expect(r.failed).toBe(0);              // 정리 실패는 색인 실패가 아니다
    expect(await store.getDocument(docIdForPath(vault, abs))).not.toBeNull();
  });

  it('★ 회귀: 옛 행 정리가 실패해도 <배치가 통째로 죽지> 않는다 (unchanged 경로)', async () => {
    const abs = write(REL, BODY);
    await indexFiles(vault, [abs], { store, embedder });     // 정본을 만든다
    await putLegacy();

    const r = await indexFiles(vault, [abs], { store: brittle(), embedder });

    expect(r.skipped).toBe(1);
    expect(await store.getDocument(docIdForPath(vault, abs))).not.toBeNull();
  });

  it('★ 회귀: 옛 행 정리가 실패해도 indexVault 가 끝까지 돈다', async () => {
    write('keep.md', BODY);
    write(REL, BODY);
    await putLegacy();

    const r = await indexVault(vault, { store: brittle(), embedder });

    expect(r.indexed).toBe(2);
    expect(r.failed).toBe(0);
  });

  it('★ 회귀: skipped 는 <변경 없음> 수다 — 스캔 실패를 섞지 않는다', async () => {
    // 화면은 result.skipped 를 "Unchanged" 로 찍는다(cli/commands/index-cmd.ts).
    // 스캔 실패를 여기 더하면 "읽지 못한 파일"이 "변경 없음"으로 보인다.
    const emptyAbs = write('empty.md', '');
    const okAbs = write('ok.md', BODY);
    await indexFiles(vault, [okAbs], { store, embedder });       // ok.md 를 색인해 둔다

    const r = await indexFiles(vault, [emptyAbs, okAbs], { store, embedder });

    expect(r.skipped).toBe(1);                                    // ok.md 하나뿐
    expect(r.skippedFiles.map(f => f.reason)).toEqual(['empty']); // empty.md 는 이쪽
  });

  it('두 경로가 <같은 입력>에 같은 skipped 를 낸다', async () => {
    write('empty.md', '');
    const okAbs = write('ok.md', BODY);
    await run();

    const a = await run();
    const b = await indexFiles(vault, [join(vault, 'empty.md'), okAbs], { store, embedder });

    expect(a.skipped).toBe(b.skipped);
    expect(a.skippedFiles.length).toBe(b.skippedFiles.length);
  });
});

// 🔴 코덱스 6b — <시험이 없어서> 살아남던 변이들 (2026-08-21 실측으로 확인).
//
// 내가 심은 변이 15개는 전부 빨갰는데, 그 15개는 <내가 고른 것>이라 시험과 같은
// 머릿속 모형에서 나왔다. 독립 리뷰가 고른 변이를 심으니 12개 중 8개가 살아남았다.
// ★판별력을 스스로 재면 자기가 지은 문에만 노크한다.
describe('시험이 없어 살아남던 변이 (코덱스 6b)', () => {
  it('★ 회귀: skipped 보호는 <이유를 가리지 않는다> — unreadable 도 지키지 않는다면 축출된다', async () => {
    // 실제 사고의 131개는 parse-error 였다. 보호를 empty|too-large 로 좁히면
    // 그 부류가 다시 축출된다. 여기서는 결정적으로 만들 수 있는 unreadable 로 잰다.
    //
    // ⚠️ 고아 심링크가 필요하다. 리눅스는 항상 되고, 윈도우는 개발자 모드/관리자가
    //    있어야 한다. 조용히 skip 하지 않고 <시끄럽게 실패>시킨다 — 이 저장소에서
    //    "스킵이 구멍을 감춘다" 를 이미 겪었다.
    write('keep.md', BODY);
    const target = join(vault, 'ghost-target.md');
    symlinkSync(target, join(vault, 'dangling.md'), 'file');   // 대상이 없다 → stat ENOENT

    const first = await run();
    expect(first.skippedFiles.map(f => f.reason)).toEqual(['unreadable']);

    // 색인에 그 문서 행을 심어 둔다 (예전에 읽혔던 문서라는 뜻).
    const danglingId = docIdForPath(vault, join(vault, 'dangling.md'));
    await store.upsertDocument({
      id: danglingId, filePath: 'dangling.md', title: 'd', content: '옛 본문',
      frontmatter: {}, tags: [], lastModified: new Date(0).toISOString(), contentHash: 'x',
    });

    const r = await run();

    expect(r.deleted).toBe(0);                                          // 지우지 않는다
    expect((await store.getAllDocuments()).map(d => d.id)).toContain(danglingId);
  });

  it('★ 회귀: 이름이 "[pack] " 로 시작하는 <진짜 파일>도 지워진다', async () => {
    // 소유 판정을 접두사로 하면 이 파일은 영원히 색인에 남는다.
    // 판정은 마커가 아니라 <id 재유도>여야 한다.
    const abs = write('[pack] notes.md', BODY);
    write('keep.md', BODY);
    await run();
    expect((await store.getAllDocuments()).length).toBe(2);

    rmSync(abs);
    const r = await run();

    expect(r.deleted).toBe(1);
    expect((await store.getAllDocuments()).map(d => d.filePath)).toEqual(['keep.md']);
  });

  it('★ 회귀: 깨진 프론트매터 문서가 <색인되고 검색된다> (표면이 아니라 끝까지)', async () => {
    // 스캐너가 되살려 놓아도 indexVault 가 버리면 결과는 같다 — 사고가 그거였다.
    // 스캐너 반환값만 재는 시험은 그 변이를 못 잡는다.
    write('broken.md', `---
title: Web — RAG Metrics: Assessing Answer Relevancy
date: 2026-06-01
---

# 제목

깨졌지만본문은살아있다.`);

    const r = await run();

    expect(r.indexed).toBe(1);
    expect(r.failed).toBe(0);
    const hits = await store.searchKeyword('깨졌지만본문은살아있다', 10);
    expect(hits.length).toBeGreaterThan(0);
  });
});

// 🔴 코덱스 7차 P1 — 삭제 연기 가드가 <스캔 실패>를 못 보던 구멍.
describe('못 읽은 파일도 삭제를 막는다 (코덱스 7차)', () => {
  it('★ 회귀: rename 의 새 이름이 <못 읽히면> 옛 행을 지우지 않는다', async () => {
    const oldAbs = write('old.md', BODY);
    await run();
    expect((await store.getAllDocuments()).length).toBe(1);

    // old.md → new.md 로 옮겼는데 새 이름이 고아 심링크다(= 못 읽는다).
    rmSync(oldAbs);
    symlinkSync(join(vault, 'no-such-target.md'), join(vault, 'new.md'), 'file');

    const r = await run();

    expect(r.failed).toBe(0);                       // 스캔 실패는 failed 가 아니다
    expect(r.skippedFiles.map(f => f.reason)).toEqual(['unreadable']);
    expect(r.deleted).toBe(0);                      // 그래도 지우지 않는다
    expect((await store.getAllDocuments()).length).toBe(1);
  });

  it('★ empty 는 삭제를 막지 <않는다> — 안정적인 성질이라 영구 차단이 된다', async () => {
    // 실볼트에 empty 가 상시 3건 있다. 이것까지 막으면 삭제가 한 번도 안 일어난다.
    const goneAbs = write('gone.md', BODY);
    write('keep.md', BODY);
    write('blank.md', '');
    await run();

    rmSync(goneAbs);
    const r = await run();

    expect(r.skippedFiles.map(f => f.reason)).toEqual(['empty']);
    expect(r.deleted).toBe(1);                      // 막히지 않는다
  });

  // 🔴 이 한 건만 POSIX 전용이다 — 이유를 이름에 드러낸다(조용한 skip 금지).
  //    indexFiles 는 existsSync 로 먼저 거르므로, "있는데 못 읽는" 상태를 만들어야만
  //    이 가드에 닿는다. 그런 상태는 POSIX 에서 chmod 000 으로만 결정적으로 만들 수 있다
  //    (윈도우 chmod 는 읽기를 못 막고, 고아 심링크는 existsSync 에서 삭제 후보로 빠진다).
  //    CI 는 ubuntu-latest 라 이 시험은 <머지 게이트에서 실제로 돈다>.
  const posixOnly = process.platform === 'win32' ? it.skip : it;
  posixOnly('★ 회귀: indexFiles 도 <못 읽은 파일>이 있으면 삭제를 미룬다 [POSIX 전용]', async () => {
    const goneAbs = write('gone.md', BODY);
    const badAbs = write('bad.md', BODY);
    await run();
    rmSync(goneAbs);
    // 🔴 순서가 중요하다: chmod 를 먼저 걸면 이 쓰기 자체가 EACCES 로 죽어
    //    <삭제 연기 로직에 닿지도 못한다> (코덱스 8차 P2). 바꾸고 나서 잠근다.
    writeFileSync(badAbs, BODY + ' 변경', { flag: 'a' });   // 내용이 바뀌어 스캔을 탄다
    chmodSync(badAbs, 0o000);                       // 있는데 못 읽는다

    try {
      const r = await indexFiles(vault, [goneAbs, badAbs], { store, embedder });
      expect(r.skippedFiles.map(f => f.reason)).toEqual(['unreadable']);
      expect(r.deleted).toBe(0);
      expect((await store.getAllDocuments()).map(d => d.filePath).sort()).toEqual(['bad.md', 'gone.md']);
    } finally {
      chmodSync(badAbs, 0o644);
    }
  });
});

// 🔴 코덱스 7차 P2 — 삭제를 미루면 <유령>이 남는다. 남는 것 자체는 의도한 선택이지만
//    (지우면 못 되돌린다), <조용히> 남으면 그건 그것대로 사고다.
//    한 파일이 영구히 실패하면 삭제가 영영 안 일어날 수 있어서, 그 상태를 셈으로 드러낸다.
//
// ★"미뤘다" 를 로그 문장으로만 두지 않는 이유: 문장은 아무도 세지 않는다.
//   IndexResult 의 숫자여야 CLI 가 찍고 시험이 잡는다.
describe('미룬 삭제가 <숫자로> 드러난다 (코덱스 7차 P2)', () => {
  it('★ 회귀: 미룬 삭제 건수를 센다 — 로그로만 흘리지 않는다', async () => {
    const goneAbs = write('old.md', BODY);
    write('keep.md', BODY);
    await run();

    rmSync(goneAbs);
    symlinkSync(join(vault, 'no-such-target.md'), join(vault, 'unreadable.md'), 'file');

    const r = await run();

    expect(r.deleted).toBe(0);
    expect(r.deferredDeletes).toBe(1);              // old.md 하나를 미뤘다
    expect((await store.getAllDocuments()).length).toBe(2);
  });

  it('★ 미룬 것이 없으면 0 이다 — 항상 0 아닌 값을 내지 않는다', async () => {
    // 🔴 이게 없으면 `deferredDeletes = existingDocs.length` 같은 변이가 통과한다.
    const goneAbs = write('gone.md', BODY);
    write('keep.md', BODY);
    await run();

    rmSync(goneAbs);
    const r = await run();

    expect(r.deleted).toBe(1);                      // 정상 실행이라 실제로 지웠다
    expect(r.deferredDeletes).toBe(0);
  });

  it('★ 임베딩이 실패해 미룬 경우도 센다', async () => {
    const goneAbs = write('gone.md', BODY);
    write('boom.md', BODY);
    await run();

    rmSync(goneAbs);
    writeFileSync(join(vault, 'boom.md'), BODY + ' 바뀜');
    const failing = {
      ...embedder,
      embedBatch: async () => { throw new Error('임베더 폭발'); },
    } as typeof embedder;

    const r = await indexVault(vault, { store, embedder: failing });

    expect(r.failed).toBe(1);
    expect(r.deleted).toBe(0);
    expect(r.deferredDeletes).toBe(1);
  });

  it('★ indexFiles 도 미룬 건수를 센다', async () => {
    const goneAbs = write('gone.md', BODY);
    const boomAbs = write('boom.md', BODY);
    await run();

    rmSync(goneAbs);
    writeFileSync(boomAbs, BODY + ' 바뀜');
    const failing = {
      ...embedder,
      embedBatch: async () => { throw new Error('임베더 폭발'); },
    } as typeof embedder;

    const r = await indexFiles(vault, [goneAbs, boomAbs], { store, embedder: failing });

    expect(r.failed).toBe(1);
    expect(r.deleted).toBe(0);
    expect(r.deferredDeletes).toBe(1);
    expect((await store.getAllDocuments()).length).toBe(2);   // 둘 다 남았다
  });
});

// 🔴 스캐너는 <점폴더·node_modules·zh-CN> 을 통째로 건너뛴다(scanner.ts:64).
//    그래서 그 안의 파일은 "디스크에 있는데 스캔에 안 잡히는" 상태가 된다 —
//    indexFiles 로 직접 색인하면 문서 행은 생기고, 이후 indexVault 는 그것을 못 본다.
//
// ★이 자리가 existsSync 가드가 <실제로 닿는> 유일한 경로다. seenOnDisk 는 skipped 도
//   담으므로(index.ts:241) 스캔이 본 파일은 애초에 후보가 안 된다. 가드를 지우면
//   <디스크에 멀쩡히 있는 파일의 색인을 지운다>.
describe('스캔 밖 폴더의 문서 — existsSync 가드 (코덱스 7차 P2)', () => {
  const outOfScan = (rel: string) => {
    const abs = join(vault, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, BODY, 'utf-8');
    return abs;
  };

  it('★ 회귀: 스캔이 못 보는 폴더의 파일을 <지우지 않는다>', async () => {
    const hidden = outOfScan('zh-CN/note.md');
    write('keep.md', BODY);
    await indexFiles(vault, [hidden], { store, embedder });
    await run();

    expect((await store.getAllDocuments()).map(d => d.filePath).sort())
      .toEqual(['keep.md', 'zh-CN/note.md']);       // 디스크에 있으니 살아 있다
  });

  it('★ 그 파일을 <미룬 삭제>로도 세지 않는다', async () => {
    // 연기 계수가 삭제 조건과 <같은 식>이어야 한다. 한쪽만 느슨하면 유령 수가 부풀어
    // "고칠 것이 있다" 는 거짓 신호를 낸다.
    const hidden = outOfScan('zh-CN/note.md');
    const boomAbs = write('boom.md', BODY);
    await indexFiles(vault, [hidden], { store, embedder });
    await run();

    writeFileSync(boomAbs, BODY + ' 바뀜');
    const failing = {
      ...embedder,
      embedBatch: async () => { throw new Error('임베더 폭발'); },
    } as typeof embedder;

    const r = await indexVault(vault, { store, embedder: failing });

    expect(r.failed).toBe(1);                       // 연기 분기에 들어갔다
    expect(r.deferredDeletes).toBe(0);              // 그래도 셀 것이 없다
  });
});

// 🔴 코덱스 8차 P2 — "미뤘다" 와 "지웠다" 가 <같은 식>이어야 한다.
//
// 예전에는 미룸 계수만 <날 후보 수>(deleteCandidates.length)를 썼다. watcher 는
// 색인에 없던 파일의 unlink 도, 저장 중이라 되살아난 경로도 후보로 넘긴다 —
// 그것까지 유령으로 세면 CLI 가 <있지도 않은 할 일>을 사람에게 보고한다.
describe('미룬 수는 실제 삭제될 것만 센다 (코덱스 8차 P2)', () => {
  const failing = () => ({
    ...embedder,
    embedBatch: async () => { throw new Error('임베더 폭발'); },
  } as typeof embedder);

  it('★ 회귀: 애초에 색인에 없던 파일의 unlink 는 유령으로 세지 않는다', async () => {
    const boomAbs = write('boom.md', BODY);
    await run();                                        // boom.md 만 색인됐다

    writeFileSync(boomAbs, BODY + ' 바뀜');
    const neverIndexed = join(vault, 'never-existed.md');   // 행도 없고 파일도 없다

    const r = await indexFiles(vault, [neverIndexed, boomAbs], { store, embedder: failing() });

    expect(r.failed).toBe(1);                           // 연기 분기에는 들어갔다
    expect(r.deferredDeletes).toBe(0);                  // 그래도 셀 것이 없다
  });

  it('★ 회귀: 저장 중이라 <되살아난> 경로도 유령이 아니다', async () => {
    const liveAbs = write('live.md', BODY);
    const boomAbs = write('boom.md', BODY);
    await run();

    // watcher 가 unlink 를 봤지만(원자적 저장의 틈) 파일은 다시 있다.
    writeFileSync(boomAbs, BODY + ' 바뀜');

    const r = await indexFiles(vault, [liveAbs, boomAbs], { store, embedder: failing() });

    expect(r.failed).toBe(1);
    expect(r.deferredDeletes).toBe(0);                  // live.md 는 디스크에 있다
    expect((await store.getAllDocuments()).length).toBe(2);
  });

  it('★ 진짜 사라진 파일은 <센다> — 항상 0 을 내는 변이를 막는다', async () => {
    const goneAbs = write('gone.md', BODY);
    const boomAbs = write('boom.md', BODY);
    await run();

    rmSync(goneAbs);
    writeFileSync(boomAbs, BODY + ' 바뀜');
    const neverIndexed = join(vault, 'never-existed.md');

    const r = await indexFiles(vault, [goneAbs, neverIndexed, boomAbs], { store, embedder: failing() });

    expect(r.deferredDeletes).toBe(1);                  // gone.md 하나뿐
  });
});

// 🔴 코덱스 8차 P2 — 이름의 <대소문자만> 바꾼 rename 이 두 행을 남기던 자리.
//
// 윈도우·macOS 기본 파일시스템은 대소문자를 구분하지 않아 `existsSync('foo.md')` 가
// 파일이 `Foo.md` 로 바뀐 뒤에도 true 를 돌려준다. 그래서 옛 행이 삭제 후보에서 빠져
// 살아남는데, SQLite 의 UNIQUE(file_path) 는 두 문자열을 <다른 값>으로 보므로
// INSERT OR REPLACE 도 못 치운다 → 같은 파일이 두 행 → 검색 결과가 중복된다.
//
// ★이 시험은 <어느 플랫폼에서든> 의미가 있다: 대소문자를 구분하는 리눅스에서는
//  옛 경로가 정말 없으므로 어차피 지워져야 하고, 안 지우면 그것도 결함이다.
describe('대소문자만 바뀐 rename (코덱스 8차 P2)', () => {
  it('★ 회귀: foo.md → Foo.md 뒤에 <행이 하나만> 남는다', async () => {
    const oldAbs = write('casenote.md', BODY);
    await run();
    expect((await store.getAllDocuments()).map(d => d.filePath)).toEqual(['casenote.md']);

    renameSync(oldAbs, join(vault, 'CaseNote.md'));

    const r = await run();

    expect(r.failed).toBe(0);
    const paths = (await store.getAllDocuments()).map(d => d.filePath);
    expect(paths).toEqual(['CaseNote.md']);            // 옛 행이 남아 있지 않다
    expect(r.deleted).toBe(1);
  });

  it('★ 스캔 밖 폴더는 <여전히> 보호된다 — 대소문자 검사가 그것을 깨지 않는다', async () => {
    // fileExistsExact 를 `() => false` 로 만드는 변이를 막는다.
    const hidden = join(vault, 'zh-CN', 'note.md');
    mkdirSync(dirname(hidden), { recursive: true });
    writeFileSync(hidden, BODY, 'utf-8');
    write('keep.md', BODY);
    await indexFiles(vault, [hidden], { store, embedder });

    await run();

    expect((await store.getAllDocuments()).map(d => d.filePath).sort())
      .toEqual(['keep.md', 'zh-CN/note.md']);
  });
});

// 🔴🔴 <내가 낸 사고>를 indexVault 자리에서 막는다 (2026-08-21).
//
// 파일 2개짜리 스크래치 폴더를 색인했더니 `Deleted: 17376` — 실볼트 색인이 사라졌다.
// CLI 의 DB 경로 결정이 config.dbPath 를 볼트 인자보다 위에 두기 때문이다.
//
// ★CLI 에만 가드를 두면 부족하다 — indexVault 를 부르는 입구가 5곳 더 있다
//  (init 명령 · API /api/reindex · watcher · 데스크톱 2곳). 지우는 코드가 여기 있으니
//  판정도 여기 있어야 한다. 그리고 <던지지 않고 삭제만 끈다> — 경로 표기가 조금
//  달라진 것만으로 멀쩡히 돌던 앱을 멈추게 하지 않으려고.
describe('남의 DB 에는 삭제하지 않는다 (2026-08-21 사고)', () => {
  it('★ 회귀: DB 가 다른 볼트의 것이면 <한 글자도 쓰지 않는다>', async () => {
    write('a.md', BODY);
    write('b.md', BODY);
    await run();
    expect((await store.getAllDocuments()).length).toBe(2);

    // 다른 볼트가 이 DB 를 소유하고 있다고 각인한다.
    store.setMeta(VAULT_OWNER_KEY, join(vault, 'somewhere-else'));

    // 디스크를 통째로 비운다 — 평소라면 둘 다 지워질 상황이다.
    rmSync(join(vault, 'a.md'));
    rmSync(join(vault, 'b.md'));
    write('only.md', BODY);

    const r = await run();

    // 🔴 예전에는 <삭제만> 껐다. 그런데 그 사이 replaceDocument 가 남의 문서 행을
    //    교체하고 옛 별칭까지 지웠다 — "삭제를 전부 건너뛴다" 는 로그가 거짓이었다
    //    (코덱스 10차 P1). 이제는 판단도 쓰기도 하지 않는다.
    expect(r.foreignDb).toBe(true);
    expect(r.indexed).toBe(0);                       // only.md 도 <안 넣는다>
    expect(r.deleted).toBe(0);
    expect(r.deferredDeletes).toBe(0);               // 미룰 것도 없다 — 판단 자체를 안 했다
    const docs = await store.getAllDocuments();
    expect(docs.map(d => d.filePath).sort()).toEqual(['a.md', 'b.md']);
  });

  it('★ 회귀: 겹침이 약하면 <각인하지 않는다> — 두 번째 실행도 막힌다', async () => {
    // 🔴🔴 이것이 P1 의 핵심이다. 예전에는 <검증보다 먼저> 각인해서, 잘못된 볼트도
    //   첫 실행에서 소유권을 가져갔다. 첫 실행은 삭제를 미루니 안전해 보였지만
    //   두 번째 실행은 ownership 이 `ok` 라 <평소대로 전부 지웠다>.
    //   즉 가드가 사고를 막은 것이 아니라 <한 번 미룬> 것이었다 (코덱스 10차 P1).
    for (let i = 0; i < 10; i++) write(`n${i}.md`, BODY);
    await run();
    store.setMeta(VAULT_OWNER_KEY, '');              // = 업그레이드 직후의 기존 DB
    for (let i = 0; i < 10; i++) rmSync(join(vault, `n${i}.md`));
    write('stranger.md', BODY);                      // 겹침 0 인 엉뚱한 폴더

    const first = await run();
    expect(first.deleted).toBe(0);
    expect(store.getMeta(VAULT_OWNER_KEY)).toBe('');   // 🔴 가져가지 않았다
    // 🔴🔴 그리고 stranger.md 를 <넣지도 않는다>. 여기가 12차 P1 의 자리다:
    //   넣으면 그 문서가 <두 번째 실행의 소유 증거>가 된다.
    expect(first.indexed).toBe(0);

    // ★그래서 두 번째 실행의 겹침도 여전히 0 이다 — 가드가 1회용이 아니다.
    const second = await run();
    expect(second.deleted).toBe(0);
    expect(store.getMeta(VAULT_OWNER_KEY)).toBe('');
    expect((await store.getAllDocuments()).length).toBe(10);
  });

  it('★ 각인은 <원자적>이다 — 경합에서 지면 지우지 않는다', async () => {
    // getMeta → setMeta 두 걸음이면 동시에 도는 두 색인이 <둘 다> 주장에 성공하고
    // 서로의 문서를 지운다 (코덱스 10차 P1). 여기서는 "다른 프로세스가 먼저
    // 가져간" 상태를 claimMeta 로 만들어, 진 쪽이 삭제를 포기하는지 본다.
    const goneAbs = write('gone.md', BODY);
    write('keep.md', BODY);
    await run();
    store.setMeta(VAULT_OWNER_KEY, '');

    // 먼저 주장한 쪽이 이긴다 — 같은 키에 두 번 claim 해도 첫 값이 남는다.
    expect(store.claimMeta(VAULT_OWNER_KEY, 'X:/first-writer')).toBe('X:/first-writer');
    expect(store.claimMeta(VAULT_OWNER_KEY, 'Y:/second-writer')).toBe('X:/first-writer');

    rmSync(goneAbs);
    const r = await run();

    expect(r.foreignDb).toBe(true);
    expect(r.deleted).toBe(0);
  });

  it('★ 각인이 없으면 <이 볼트가 가져간다> — 첫 색인을 막지 않는다', async () => {
    expect(store.getMeta(VAULT_OWNER_KEY)).toBeUndefined();
    write('a.md', BODY);

    await run();

    expect(store.getMeta(VAULT_OWNER_KEY)).toBe(resolvePath(vault));
  });

  // 🔴 여기 있던 시험은 <틀렸었다>. "각인 없는 기존 DB 도 그 실행에서 바로 지운다" 를
  //    회귀로 못박았는데, 코덱스 9차가 그것이 바로 사고의 재현 조건임을 지적했다:
  //    각인은 오늘 생긴 장치라 <기존 DB 는 전부> 각인이 없다. 그 상태로 다른 폴더를
  //    색인하면 그 폴더 소유로 각인한 뒤 전부 지운다 — 가드를 넣기 전과 같다.
  //    ★내가 변이 H4 를 보고 "삭제가 밀리는 것" 을 결함으로 읽었는데, 그게 안전한 쪽이었다.
  //    변이가 살아남았다고 해서 <내가 상상한 방향>이 옳은 것은 아니다.
  it('★ 회귀: 각인 없는 DB + 겹침 0 이면 <한 건도 안 지운다> (업그레이드 사고)', async () => {
    const goneAbs = write('gone.md', BODY);
    write('keep.md', BODY);
    await run();
    store.setMeta(VAULT_OWNER_KEY, '');            // = 업그레이드 직후의 기존 DB

    // 이 볼트의 파일을 전부 치우고 <전혀 다른> 파일 하나만 둔다 = 겹침 0.
    rmSync(goneAbs);
    rmSync(join(vault, 'keep.md'));
    write('stranger.md', BODY);

    const r = await run();

    expect(r.deleted).toBe(0);
    // 🔴 미룰 것도 <0> 이다 — 삭제 판단 자체를 하지 않는다. 한때 2 였고, 그 2 는
    //    "판단은 했는데 미뤘다" 는 뜻이었다. 지금은 판단 전에 돌아간다 (12차 P1).
    expect(r.deferredDeletes).toBe(0);
    expect(r.indexed).toBe(0);                     // stranger.md 도 안 넣는다
    expect((await store.getAllDocuments()).length).toBe(2);
  });

  it('★ 각인 없는 DB 라도 <겹치면> 평소대로 지운다 — 업그레이드를 막지 않는다', async () => {
    const goneAbs = write('gone.md', BODY);
    write('keep.md', BODY);
    await run();
    store.setMeta(VAULT_OWNER_KEY, '');

    rmSync(goneAbs);                                // keep.md 는 남는다 = 겹침 있음

    const r = await run();

    expect(r.deferredDeletes).toBe(0);
    expect(r.deleted).toBe(1);
  });

  it('★ 볼트 폴더가 <통째로 비어> 보여도 지우지 않는다 (마운트 실패 모양)', async () => {
    write('a.md', BODY);
    write('b.md', BODY);
    await run();
    store.setMeta(VAULT_OWNER_KEY, '');
    rmSync(join(vault, 'a.md'));
    rmSync(join(vault, 'b.md'));

    const r = await run();

    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).length).toBe(2);
  });

  it('★ 같은 볼트면 <평소대로 지운다> — 가드가 삭제를 영영 막지 않는다', async () => {
    const goneAbs = write('gone.md', BODY);
    write('keep.md', BODY);
    await run();                                     // 여기서 각인된다

    rmSync(goneAbs);
    const r = await run();

    expect(r.deleted).toBe(1);
    expect(r.deferredDeletes).toBe(0);
  });
});

// 🔴 코덱스 9차 P2 — 마지막 칸만 대소문자를 보면 <상위 폴더>의 변경을 놓친다.
describe('상위 폴더의 대소문자 변경 (코덱스 9차 P2)', () => {
  it('★ 회귀: Folder/note.md → folder/note.md 뒤에 행이 하나만 남는다', async () => {
    mkdirSync(join(vault, 'Folder'), { recursive: true });
    writeFileSync(join(vault, 'Folder', 'note.md'), BODY, 'utf-8');
    await run();
    expect((await store.getAllDocuments()).map(d => d.filePath)).toEqual(['Folder/note.md']);

    // 대소문자만 바꾼다 (윈도우는 한 번에 못 바꾸므로 경유한다).
    renameSync(join(vault, 'Folder'), join(vault, 'tmp-rename'));
    renameSync(join(vault, 'tmp-rename'), join(vault, 'folder'));

    await run();

    expect((await store.getAllDocuments()).map(d => d.filePath)).toEqual(['folder/note.md']);
  });
});

// 🔴 코덱스 9차 P2 — 존재 확인과 실제 삭제 사이에 파일이 <되살아나는> 경우.
describe('삭제 직전 재확인 (코덱스 9차 P2)', () => {
  it('★ 회귀: 조회 도중 rename 이 끝나 파일이 돌아오면 지우지 않는다', async () => {
    const goneAbs = write('race.md', BODY);
    write('keep.md', BODY);
    await run();

    rmSync(goneAbs);

    // getDocument 가 호출되는 <그 사이에> 파일이 돌아오게 만든다 = 원자적 rename 의 끝.
    let revived = false;
    const racing = new Proxy(store, {
      get(t, k, r) {
        if (k === 'getDocument') {
          return async (id: string) => {
            if (!revived) { writeFileSync(goneAbs, BODY, 'utf-8'); revived = true; }
            return (t as VectorStore).getDocument(id);
          };
        }
        return Reflect.get(t, k, r);
      },
    }) as VectorStore;

    const r = await indexFiles(vault, [goneAbs], { store: racing, embedder });

    expect(revived).toBe(true);                    // 경합을 실제로 만들었다
    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).map(d => d.filePath).sort())
      .toEqual(['keep.md', 'race.md']);
  });
});

// 🔴🔴 형제 진입점에도 문이 있어야 한다 (코덱스 10차 P1).
//   indexVault 만 지켜도 안전해 보이는 이유는, 시험이 indexVault 로만 짜여 있기
//   때문이다. 데스크톱 감시자는 indexFiles 를 <직접> 부른다.
describe('indexFiles 도 DB 짝짓기를 본다 (코덱스 10차 P1)', () => {
  it('★ 회귀: 남의 DB 면 배치가 <한 글자도 쓰지 않는다>', async () => {
    const a = write('a.md', BODY);
    await indexFiles(vault, [a], { store, embedder });
    expect((await store.getAllDocuments()).length).toBe(1);

    store.setMeta(VAULT_OWNER_KEY, 'X:/somewhere-else');
    const b = write('b.md', BODY);

    const r = await indexFiles(vault, [b], { store, embedder });

    expect(r.foreignDb).toBe(true);
    expect(r.indexed).toBe(0);
    const docs = await store.getAllDocuments();
    expect(docs.map(d => d.filePath)).toEqual(['a.md']);
  });

  it('★ 회귀: 각인이 없고 <파일 문서가 이미 있으면> 배치는 아무것도 하지 않는다', async () => {
    // 배치는 볼트 <일부>만 보므로 겹침 비율을 물을 수 없다. 한때 그 사실을
    // "그러니 색인은 계속하고 삭제만 미룬다" 로 읽었는데 <반대였다> (12차 P1):
    // 못 묻는다는 것은 허락할 근거가 아니라 더 막을 근거다.
    const gone = write('gone.md', BODY);
    await indexFiles(vault, [gone], { store, embedder });
    store.setMeta(VAULT_OWNER_KEY, '');            // 업그레이드 직후
    rmSync(gone);

    const r = await indexFiles(vault, [gone], { store, embedder });

    expect(r.ownershipUnverified).toBe(true);
    expect(r.deleted).toBe(0);                     // 안 지웠다
    expect(r.deferredDeletes).toBe(0);             // 미룰 <판단조차> 안 했다
    expect(store.getMeta(VAULT_OWNER_KEY)).toBe('');   // 각인도 안 가져간다
    expect((await store.getAllDocuments()).length).toBe(1);
  });

  it('★ 그래도 <파일 문서가 0 인> DB 면 배치가 스스로 각인한다 — 감시자를 영영 막지 않는다', async () => {
    // 🔴 이 갈래가 없으면, 전체 색인을 한 번도 안 돌린 새 볼트에서 데스크톱 감시자가
    //    <영원히> 아무것도 못 쓴다. 잃을 것이 0 이므로 여기서는 가져간다.
    expect(store.getMeta(VAULT_OWNER_KEY)).toBeUndefined();
    const a = write('a.md', BODY);

    const r = await indexFiles(vault, [a], { store, embedder });

    expect(r.ownershipUnverified).toBeFalsy();
    expect(r.indexed).toBe(1);
    expect(store.getMeta(VAULT_OWNER_KEY)).toBe(resolvePath(vault));
  });

  it('★ 각인이 맞으면 배치도 <평소대로 지운다> — 가드가 영영 막지 않는다', async () => {
    const gone = write('gone.md', BODY);
    await indexFiles(vault, [gone], { store, embedder });
    store.setMeta(VAULT_OWNER_KEY, resolvePath(vault));
    rmSync(gone);

    const r = await indexFiles(vault, [gone], { store, embedder });

    expect(r.deferredDeletes).toBe(0);
    expect(r.deleted).toBe(1);
    expect((await store.getAllDocuments()).length).toBe(0);
  });

  it('★ 회귀: 볼트 경로의 <대소문자 표기>가 달라도 멀쩡한 파일을 지우지 않는다', async () => {
    // fileExistsExact 가 파일시스템 루트까지 거슬러 올라가던 시절, 볼트 경로 자체의
    // 표기가 디스크와 다르면(설정 f:/obsidian, 디스크 F:/Obsidian) 멀쩡한 파일을
    // "없다" 로 판정했다 — 그 값이 곧 삭제 허가였다 (코덱스 10차 P1).
    const keep = write('keep.md', BODY);
    await indexFiles(vault, [keep], { store, embedder });

    // 🔴 각인을 <소문자 표기>로 맞춘다. 안 그러면 mismatch 나 "각인 없음" 가드가
    //    먼저 삭제를 막아서, 경계 검사가 사라져도 시험이 초록으로 남는다 —
    //    처음에 그렇게 짰다가 변이가 살아남는 것을 보고 알았다.
    const lowered = vault.toLowerCase();
    store.setMeta(VAULT_OWNER_KEY, resolvePath(lowered));

    const r = await indexFiles(lowered, [join(lowered, 'keep.md')], { store, embedder });

    expect(r.deferredDeletes).toBe(0);          // 가드에 가려지지 않았다는 확인
    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).length).toBe(1);
  });
});

// 코덱스 10차 이후 <살아남은 변이>에 붙이는 시험들. 고친 것과 재는 것은 다르다(§9.3.3).
describe('삭제 판정의 나머지 구멍 (변이 잔존분)', () => {
  const doc = (id: string, filePath: string) => ({
    id, filePath, title: 't', content: '본문', frontmatter: {}, tags: [],
    lastModified: new Date(0).toISOString(), contentHash: 'h-' + id,
  });

  it('★ 회귀: 부모가 <파일>이면(ENOTDIR) 지우지 않는다 — 못 읽었으면 보수적으로', async () => {
    // fileExistsExact 의 catch 가 existsSync 로 되돌아가면 여기서 false 가 나와
    // <삭제 허가>가 떨어진다. ENOENT 가 아닌 실패는 "판단 불가" 여야 한다.
    write('afile.md', BODY);                       // 이것을 <폴더처럼> 지나가게 만든다
    const rel = 'afile.md/ghost.md';
    await store.upsertDocument(doc(docIdForPath(vault, join(vault, rel)), rel));
    store.setMeta(VAULT_OWNER_KEY, resolvePath(vault));

    const r = await run();

    expect(r.deleted).toBe(0);
    expect((await store.getAllDocuments()).map(d => d.filePath)).toContain(rel);
  });

  it('★ 회귀: 대소문자만 다른 두 행이 함께 사라지면 <1건>으로 센다', async () => {
    write('keep.md', BODY);
    for (const rel of ['Foo.md', 'foo.md']) {
      await store.upsertDocument(doc(docIdForPath(vault, join(vault, rel)), rel));
    }
    store.setMeta(VAULT_OWNER_KEY, resolvePath(vault));
    expect((await store.getAllDocuments()).length).toBe(2);   // keep.md 는 아직 행이 없다

    const r = await run();

    expect(r.deleted).toBe(1);                     // 두 행이지만 <한 파일>이다
    expect((await store.getAllDocuments()).map(d => d.filePath).sort()).toEqual(['keep.md']);
  });

  it('★ 회귀: 미룬 수는 <되살아난 파일>을 빼고 센다', async () => {
    const gone = write('gone.md', BODY);
    await indexFiles(vault, [gone], { store, embedder });
    store.setMeta(VAULT_OWNER_KEY, '');            // 각인 없음 → 연기 분기로 간다
    rmSync(gone);

    // doomed 를 만든 <뒤에> 파일이 되살아나는 상황. getDocument 가 그 틈이다.
    const reviving = new Proxy(store, {
      get(t, k, r) {
        if (k === 'getDocument') {
          return async (id: string) => {
            const d = await (t as VectorStore).getDocument(id);
            writeFileSync(gone, BODY, 'utf-8');    // 원자적 저장이 끝났다
            return d;
          };
        }
        return Reflect.get(t as object, k, r);
      },
    }) as VectorStore;

    const res = await indexFiles(vault, [gone], { store: reviving, embedder });

    expect(res.deferredDeletes).toBe(0);           // 되살아났으니 미룰 것도 없다
    expect(res.deleted).toBe(0);
  });

  it('★ 회귀: 두 행 삭제가 실패하면 <부분 삭제를 남기지 않는다>', async () => {
    const REL2 = '00_Inbox/two.md';
    const abs = write(REL2, BODY);
    await indexFiles(vault, [abs], { store, embedder });          // 정본 행
    await store.upsertDocument(doc(legacyId(REL2), legacyPath(REL2)));  // 옛 행
    store.setMeta(VAULT_OWNER_KEY, resolvePath(vault));
    rmSync(abs);
    expect((await store.getAllDocuments()).length).toBe(2);

    const failing = new Proxy(store, {
      get(t, k, r) {
        if (k === 'deleteByDocumentIds') {
          return async () => { throw new Error('두 번째에서 터진다'); };
        }
        return Reflect.get(t as object, k, r);
      },
    }) as VectorStore;

    const res = await indexFiles(vault, [abs], { store: failing, embedder });

    // 🔴 한 행만 사라진 상태가 <아니어야> 한다. 트랜잭션이라 둘 다 남는다.
    expect((await store.getAllDocuments()).length).toBe(2);
    expect(res.deleted).toBe(0);                   // 보고도 사실과 같다
    expect(res.failed).toBe(1);
  });

  it('★ 회귀: file_path 충돌로 쫓겨난 행의 임베딩도 고아로 안 남는다', async () => {
    // UNIQUE(file_path) 때문에 <다른 id> 의 행이 REPLACE 에 쫓겨난다. 그 행의
    // 임베딩은 doc.id 기준 선정리에 안 걸려 고아가 됐다 (코덱스 10차 P1).
    const vec = [0.1, 0.2, 0.3, 0.4];
    await store.replaceDocument(doc('idA', 'same.md') as never, [
      { id: 'idA#0', documentId: 'idA', content: 'a', startLine: 0, endLine: 1,
        tokenCount: 1, embedding: vec } as never,
    ]);
    await store.replaceDocument(doc('idB', 'same.md') as never, [
      { id: 'idB#0', documentId: 'idB', content: 'b', startLine: 0, endLine: 1,
        tokenCount: 1, embedding: vec } as never,
    ]);

    const db = store.getDb() as never as {
      prepare(q: string): { get(): { n: number } };
    };
    const orphans = db.prepare(
      'SELECT COUNT(*) AS n FROM chunk_embeddings e'
      + ' WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.id = e.chunk_id)',
    ).get().n;
    expect(orphans).toBe(0);
  });

  it('★ 각인 경합에서 진 쪽은 <색인도> 하지 않는다', async () => {
    // 🔴 처음에 이 시험은 <다른 이유로> 통과했다: claimMeta 로 남의 각인을 심으면
    //    다음 실행의 ownership 이 곧바로 mismatch 라, 경합 분기에 <닿지도 않았다>.
    //    변이(경합 패배 시 계속 진행)를 심어 보고서야 알았다.
    //    진짜 경합은 <읽을 때는 비어 있었는데 쓸 때는 남이 가져간> 상태다.
    write('a.md', BODY);
    await run();                                   // 여기서 각인된다
    write('b.md', BODY);

    const raced = new Proxy(store, {
      get(t, k, r) {
        if (k === 'getMeta') {
          return (key: string) => (key === VAULT_OWNER_KEY ? '' : (t as VectorStore).getMeta(key));
        }
        if (k === 'claimMeta') {
          return () => 'X:/first-writer';          // 그 찰나에 남이 가져갔다
        }
        return Reflect.get(t as object, k, r);
      },
    }) as VectorStore;

    const res = await indexVault(vault, { store: raced, embedder });

    expect(res.foreignDb).toBe(true);
    expect(res.indexed).toBe(0);                   // 승자의 DB 에 <쓰지 않는다>
    expect((await store.getAllDocuments()).map(d => d.filePath)).toEqual(['a.md']);
  });

  it('★ 회귀: 두 행 삭제는 <트랜잭션>이다 — 중간 실패가 부분 상태를 안 남긴다', async () => {
    // Proxy 로 메서드를 통째로 바꾸면 <진짜 구현의 원자성>은 재지지 않는다.
    // 실제 SQL 을 중간에 터뜨려야 한다 — 트리거가 그 도구다.
    await store.upsertDocument(doc('keep-me', 'keep-me.md'));
    await store.upsertDocument(doc('boom', 'boom.md'));
    const db = store.getDb() as never as { exec(q: string): void };
    db.exec(
      'CREATE TRIGGER boom_guard BEFORE DELETE ON documents'
      + " WHEN OLD.id = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    );

    await expect(store.deleteByDocumentIds(['keep-me', 'boom'])).rejects.toThrow();

    // 🔴 트랜잭션이 아니면 첫 행은 이미 사라졌다.
    const left = (await store.getAllDocuments()).map(d => d.id).sort();
    expect(left).toEqual(['boom', 'keep-me']);
    db.exec('DROP TRIGGER boom_guard');
  });

  it('★ 회귀: 증분 경로도 <대소문자 rename> 을 삭제 후보로 본다', async () => {
    // 후보 수집이 existsSync 로 되돌아가면, 대소문자를 안 가리는 FS 에서 옛 경로가
    // "있다" 로 나와 후보에서 빠지고 두 행이 영원히 남는다 (코덱스 10차 P2).
    const lower = write('caserename.md', BODY);
    await indexFiles(vault, [lower], { store, embedder });
    store.setMeta(VAULT_OWNER_KEY, resolvePath(vault));

    const upper = join(vault, 'CaseRename.md');
    renameSync(lower, upper);
    // 대소문자를 <가리는> 파일시스템에서는 이 시험이 무의미하다 — 그때는 건너뛴다.
    if (!existsSync(lower)) return;

    await indexFiles(vault, [lower, upper], { store, embedder });

    const paths = (await store.getAllDocuments()).map(d => d.filePath);
    expect(paths).toEqual(['CaseRename.md']);      // 옛 철자 행이 안 남는다
  });

  it('★ 겹침이 약한 경우는 foreignDb 가 아니라 <ownershipUnverified> 다', async () => {
    for (let i = 0; i < 6; i++) write(`n${i}.md`, BODY);
    await run();
    store.setMeta(VAULT_OWNER_KEY, '');
    for (let i = 0; i < 6; i++) rmSync(join(vault, `n${i}.md`));
    write('stranger.md', BODY);

    const r = await run();

    // ★둘은 다른 상태다: foreignDb 는 <소유자가 확정적으로 남>, unverified 는 <모름>.
    //   호출부가 이 둘에 다르게 답해야 해서 값을 나눠 둔다.
    expect(r.foreignDb).toBeFalsy();
    expect(r.ownershipUnverified).toBe(true);
    // 🔴 한때 여기 `indexed === 1` 이었다 — "삭제만 건너뛰었다" 던 시절.
    //   그 1 이 다음 실행의 증거가 됐다 (12차 P1). 지금은 아무것도 안 쓴다.
    expect(r.indexed).toBe(0);
    expect(r.deleted).toBe(0);
  });
});

// 코덱스 11회차 (2026-08-21). 20건 중 6건은 <내 리뷰 하네스가 만든 착시>였다 —
// diff 를 store / indexer 두 영역으로 쪼개 보냈더니, 검토자가 못 본 쪽을 두고
// "호출부가 없다" 고 다섯 번 적었다. 아래는 <살아남은 지적>에 붙이는 시험이다.
describe('코덱스 11차 — 미확인 소유는 <덮지 않는다>', () => {
  const doc = (id: string, filePath: string) => ({
    id, filePath, title: 't', content: '남의 본문', frontmatter: {}, tags: [],
    lastModified: new Date(0).toISOString(), contentHash: 'h-' + id,
  });

  it('★ 미확인이면 <이미 있는 행을 덮지도, 새 문서를 넣지도> 않는다', async () => {
    // 겹침이 약한 DB 에 같은 상대경로의 행이 있으면, 예전 구현은 replaceDocument 로
    // 그것을 <덮어썼다>. "삭제만 건너뛴다" 는 로그가 거짓이었다 (코덱스 11차 P1).
    // 🔴 그 다음 절충("새 문서만 넣는다")도 틀렸다 (12차 P1) — 넣은 문서가 증거가 된다.
    const rel = 'collide.md';
    write(rel, BODY);
    // 🔴 "남의 문서" 도 <파일 색인이 소유한> 모양이어야 모수에 든다 — id 를 경로에서
    //    유도하지 않으면 ingest/pack 문서로 취급돼 판정에서 빠진다(그게 설계다).
    for (let i = 0; i < 8; i++) {
      const theirs = 'theirs/n' + i + '.md';
      await store.upsertDocument(doc(docIdForPath(vault, join(vault, theirs)), theirs));
    }
    await store.upsertDocument(doc(docIdForPath(vault, join(vault, rel)), rel));
    write('brand-new.md', BODY);

    const r = await run();

    expect(r.ownershipUnverified).toBe(true);
    // 🔴 남의 행은 <글자 하나> 안 바뀐다
    const kept = (await store.getAllDocuments()).find(d => d.filePath === rel);
    expect(kept?.content).toBe('남의 본문');
    // 🔴 없던 문서도 <들어오지 않는다>. 진척을 남기는 것이 곧 증거를 만드는 것이다.
    expect((await store.getAllDocuments()).map(d => d.filePath)).not.toContain('brand-new.md');
    expect(r.indexed).toBe(0);
    expect(r.deleted).toBe(0);
  });

  it('★ 미확인이면 <옛 별칭 정리>도 하지 않는다', async () => {
    // 정리는 "같은 파일의 중복" 판정 위에 서 있고, 그 판정은 이 DB 가 이 볼트의
    // 것이라는 전제를 쓴다. 남의 DB 라면 그 행은 중복이 아니라 남의 문서다.
    // 🔴 별칭은 경로에 구분자가 <있어야> 생긴다 — 루트 파일은 canonical === legacy 라
    //    두 행이 애초에 안 만들어진다. 처음에 'aliased.md' 로 썼다가 변이가 살아남아
    //    알았다: 시험이 <가드가 아니라 우연>을 재고 있었다.
    const rel = 'sub/aliased.md';
    write(rel, BODY);
    for (let i = 0; i < 8; i++) {
      const theirs = 'theirs/n' + i + '.md';
      await store.upsertDocument(doc(docIdForPath(vault, join(vault, theirs)), theirs));
    }
    // 🔴 docIdForPath 는 경로를 '/' 로 정규화한 뒤 해시하므로 역슬래시를 넣어도
    //    canonical id 가 나온다 — 그러면 두 행이 아니라 <한 행>이다. legacyId 를 쓴다.
    await store.upsertDocument(doc(legacyId(rel), legacyPath(rel)));

    const r = await run();

    expect(r.ownershipUnverified).toBe(true);
    const paths = (await store.getAllDocuments()).map(d => d.filePath);
    expect(paths).toContain(legacyPath(rel));   // 옛 행이 <남는다>
  });

  it('★ 겹침은 <경로>로 센다 — 옛 형식 id 만 있는 DB 도 자기 볼트를 알아본다', async () => {
    // 🔴 id 로 세면 <평범한 업그레이드가 겹침 0> 이 된다: 같은 파일인데 옛 형식
    //    id(역슬래시 경로)라 id 가 다르다. 그러면 그 볼트는 영영 각인을 못 한다.
    const rels = Array.from({ length: 6 }, (_, i) => 'sub/n' + i + '.md');
    for (const rel of rels) write(rel, BODY);
    for (const rel of rels) {
      const legacy = rel.split('/').join(String.fromCharCode(92));
      await store.upsertDocument(doc(docIdForPath(vault, join(vault, legacy)), legacy));
    }

    const r = await run();

    expect(r.ownershipUnverified).toBeFalsy();               // 같은 볼트로 알아본다
    expect(store.getMeta(VAULT_OWNER_KEY)).toBe(resolvePath(vault));
    expect(r.indexed).toBe(6);
  });

  it('★ 모수는 <파일 색인이 소유한 문서>만 센다 — ingest 만 든 DB 는 첫 색인이 막히지 않는다', async () => {
    // pack/ingest 문서는 디스크 파일이 아니라 이 판정의 증거가 못 된다.
    for (let i = 0; i < 20; i++) {
      await store.upsertDocument(doc('pack_x' + i, '[pack] x' + i));
    }
    write('mine.md', BODY);

    const r = await run();

    expect(r.ownershipUnverified).toBeFalsy();
    expect(r.indexed).toBe(1);
    expect(store.getMeta(VAULT_OWNER_KEY)).toBe(resolvePath(vault));
  });

  it('★ 회귀: indexVault 도 <한 파일의 여러 행>을 한 번에 지운다', async () => {
    // 하나씩 지우면 두 번째 실패가 부분 삭제를 남기고, try/catch 도 없어 함수가
    // <결과 없이> reject 됐다 — 앞서 지운 것들은 이미 사라진 채로 (코덱스 11차 P2).
    const rel = 'sub/twin.md';
    const abs = write(rel, BODY);
    await run();
    await store.upsertDocument(doc(legacyId(rel), legacyPath(rel)));   // 같은 파일의 <옛 행>
    rmSync(abs);

    const calls: string[][] = [];
    const spy = new Proxy(store, {
      get(t, k, r) {
        if (k === 'deleteByDocumentIds') {
          return async (ids: string[]) => {
            calls.push([...ids]);
            return (t as VectorStore).deleteByDocumentIds(ids);
          };
        }
        return Reflect.get(t as object, k, r);
      },
    }) as VectorStore;

    await indexVault(vault, { store: spy, embedder });

    // 🔴 <한 파일 = 한 호출>. 행마다 부르면 부분 삭제가 가능해진다.
    //    ★"길이 >= 1" 로 쟀다가 변이가 살아남았다 — 그 식은 행 단위 호출도 참이다.
    expect(calls.some(ids => ids.length === 2)).toBe(true);
    expect(calls.every(ids => new Set(ids).size === ids.length)).toBe(true);
    expect((await store.getAllDocuments()).map(d => d.filePath)).not.toContain(rel);
  });

  it('★ 회귀: indexVault 의 삭제 실패가 <함수 전체를 무너뜨리지> 않는다', async () => {
    const abs = write('boom.md', BODY);
    write('keep.md', BODY);
    await run();
    rmSync(abs);

    const failing = new Proxy(store, {
      get(t, k, r) {
        if (k === 'deleteByDocumentIds') {
          return async () => { throw new Error('삭제가 터진다'); };
        }
        return Reflect.get(t as object, k, r);
      },
    }) as VectorStore;

    const res = await indexVault(vault, { store: failing, embedder });   // reject 하지 않는다

    expect(res.failed).toBe(1);
    expect(res.deleted).toBe(0);                    // 보고가 사실과 같다
    expect((await store.getAllDocuments()).length).toBe(2);
  });

  it('★ 회귀: 미룬 수는 <DB 행이 있는 것>만 센다', async () => {
    // 파일이 없다는 것만으로 세면, 애초에 행이 없던 경로까지 "미뤘다" 고 보고해
    // <있지도 않은 할 일>을 유령으로 남긴다 (코덱스 11차 P2).
    // ⚠️ 연기를 트리거하는 조건이 바뀌었다: 예전에는 <미각인>이 조건이었는데,
    //    이제 미각인은 배치를 통째로 멈추므로 여기 닿지 못한다. 남은 조건은 <실패>다.
    const gone = write('gone.md', BODY);
    const churn = write('churn.md', BODY);
    await indexFiles(vault, [gone, churn], { store, embedder });   // 각인 + 행 2개
    rmSync(gone);
    write('churn.md', BODY + ' 바뀌었다');            // 재색인 대상 → 임베더를 탄다
    const neverIndexed = join(vault, 'never-existed.md');
    const dead: Embedder = {
      modelName: 'test-dead', dimensions: DIMS,
      embed: async () => { throw new Error('embedder down'); },
      embedBatch: async () => { throw new Error('embedder down'); },
    };

    const r = await indexFiles(vault, [gone, churn, neverIndexed], { store, embedder: dead });

    expect(r.failed).toBe(1);                       // churn.md 가 실패했다 = 불완전한 배치
    expect(r.deferredDeletes).toBe(1);              // 2 가 아니다 — 행이 있는 것만
  });

  it('★ 회귀: indexFiles 도 소유 미확인을 <보고한다>', async () => {
    // 🔴 미확인을 만들려면 <파일 색인이 소유한 남의 문서>가 있어야 한다.
    //    빈 DB 는 잃을 것이 없어 배치가 스스로 각인한다(바로 위 시험).
    const theirs = 'theirs/n0.md';
    await store.upsertDocument(doc(docIdForPath(vault, join(vault, theirs)), theirs));
    const abs = write('a.md', BODY);

    const r = await indexFiles(vault, [abs], { store, embedder });

    expect(r.ownershipUnverified).toBe(true);       // 삭제 후보가 0 이어도 알 수 있다
    expect(r.indexed).toBe(0);
    expect(r.deferredDeletes).toBe(0);
  });
});

// 🔴 1회성 유지보수(링크 백필 · 고아 임베딩 정리)는 store.initialize() 를 떠났다
//    (코덱스 12차 P1) — 여는 것만으로 남의 DB 에 쓰던 자리였다.
//    ★그러면 <누가 부르는가>가 새 질문이 된다. 아무도 안 부르면 옛 DB 는 영영 이관되지 않고,
//     그 사실을 재는 것이 없으면 조용히 그렇게 된다. 그래서 여기서 잰다.
describe('색인기가 1회성 유지보수를 돌린다 (코덱스 12차 P1)', () => {
  const MARKER = 'links_backfill_v1';

  it('★ indexVault 는 소유를 확인한 <뒤> 유지보수를 돌린다', async () => {
    write('a.md', BODY);
    expect(store.getMeta(MARKER)).toBeUndefined();     // 여는 것만으로는 안 돈다

    await run();

    expect(store.getMeta(MARKER)).toBeTruthy();
  });

  it('★ indexFiles 도 돌린다 — 감시자만 도는 경로가 이관에서 빠지지 않게', async () => {
    const a = write('a.md', BODY);
    expect(store.getMeta(MARKER)).toBeUndefined();

    await indexFiles(vault, [a], { store, embedder });

    expect(store.getMeta(MARKER)).toBeTruthy();
  });

  it('★ 소유가 미확인이면 유지보수도 <돌지 않는다> — 그것도 남의 DB 에 쓰는 것이다', async () => {
    for (let i = 0; i < 6; i++) write(`n${i}.md`, BODY);
    await run();
    store.setMeta(VAULT_OWNER_KEY, '');
    store.setMeta(MARKER, '');                         // 마커를 비워 다시 돌 수 있게 둔다
    for (let i = 0; i < 6; i++) rmSync(join(vault, `n${i}.md`));
    write('stranger.md', BODY);                        // 겹침 0

    const r = await run();

    expect(r.ownershipUnverified).toBe(true);
    expect(store.getMeta(MARKER)).toBe('');            // 안 돌았다
  });
});

// 🔴 삭제 후보를 좁힐 때 `getDocument` 가 <터지면> 그 경로는 확인 없이 후보로 남는다.
//    그것이 옳다 — 없다고 단정하면 유실을 놓친다. 다만 그때의 "미룬 N 건" 은
//    <행이 있는지 모르는 것>을 포함하므로, 그 사실을 수로 드러낸다 (코덱스 12차 P2).
describe('조회가 실패한 후보는 <모른다고> 보고한다 (코덱스 12차 P2)', () => {
  it('★ 미룬 수에 섞이되, 몇 건이 <모르는 것>인지 로그에 남는다', async () => {
    const gone = write('gone.md', BODY);
    write('churn.md', BODY);
    await indexFiles(vault, [gone, join(vault, 'churn.md')], { store, embedder });
    rmSync(gone);
    write('churn.md', BODY + ' 바뀌었다');           // 재색인 대상 → 임베더를 탄다

    const goneId = docIdForPath(vault, gone);
    const brittle = new Proxy(store, {
      get(t, k, r) {
        if (k === 'getDocument') {
          return async (id: string) => {
            if (id === goneId) throw new Error('조회가 터진다');
            return (t as VectorStore).getDocument(id);
          };
        }
        return Reflect.get(t as object, k, r);
      },
    }) as VectorStore;
    const dead: Embedder = {
      modelName: 'test-dead', dimensions: DIMS,
      embed: async () => { throw new Error('embedder down'); },
      embedBatch: async () => { throw new Error('embedder down'); },
    };

    const lines: string[] = [];
    const realErr = console.error;
    console.error = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    let r;
    try {
      r = await indexFiles(vault, [gone, join(vault, 'churn.md')], { store: brittle, embedder: dead });
    } finally {
      console.error = realErr;
    }

    expect(r.failed).toBe(1);                        // churn.md — 배치가 불완전하다
    expect(r.deferredDeletes).toBe(1);               // 보수적으로 후보에 남겼다
    // 🔴 그 1 이 <확인된 1> 이 아니라는 것을 말한다. 안 적으면 "행이 있다" 로 읽힌다.
    const deferLine = lines.find(l => l.includes('삭제 1건을 미룬다'));
    expect(deferLine).toBeTruthy();
    expect(deferLine).toContain('1건은 DB 조회가 실패');
    expect((await store.getAllDocuments()).length).toBe(2);   // 아무것도 안 지웠다
  });
});
