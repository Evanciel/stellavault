// 🔴 "문서 행은 남았는데 검색이 안 된다" 를 만드는 자리들.
//
// documents 의 INSERT OR REPLACE 는 행을 <지웠다 다시 넣으므로> FK 의 ON DELETE CASCADE 가
// 그 문서의 청크를 전부 날린다. 그래서 upsertDocument 를 <단독으로> 부르는 경로는
// 전부 같은 결함을 가진다 — 색인기에서 고쳐도 다른 호출부에 그대로 남아 있었다
// (코덱스 7차 P1, 2026-08-21: api/server.ts PUT · pack/importer.ts).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { createSqliteVecStore, upsertDocument as upsertDocumentRaw } from '../src/store/sqlite-vec.js';
import type { VectorStore } from '../src/store/types.js';
import type { Document, Chunk } from '../src/types/document.js';

const DIMS = 4;
let store: VectorStore;
beforeEach(async () => { store = createSqliteVecStore(':memory:', DIMS); await store.initialize(); });
afterEach(async () => { await store.close(); });

const DOC: Document = {
  id: 'd1', filePath: 'a.md', title: 'a', content: '첫번째본문이있다',
  frontmatter: {}, tags: [], lastModified: '2026-01-01', contentHash: 'h1',
};
const CHUNK = {
  id: 'd1#0', documentId: 'd1', content: '첫번째본문이있다',
  heading: '', startLine: 0, endLine: 1, tokenCount: 2, embedding: [1, 0, 0, 0],
} as unknown as Chunk;

describe('청크를 잃지 않는다', () => {
  it('★ upsertDocument <단독>은 청크를 날린다 — 이 사실을 못박아 둔다', async () => {
    await store.replaceDocument(DOC, [CHUNK]);
    expect(await store.searchKeyword('첫번째본문이있다', 10)).toHaveLength(1);

    await store.upsertDocument({ ...DOC, content: '둘째', contentHash: 'h2' });

    // 🔴 이것이 <결함이 아니라 SQLite 의 사실>이다. 그래서 호출부가 조심해야 한다.
    expect(await store.searchKeyword('첫번째본문이있다', 10)).toHaveLength(0);
  });

  it('★ 회귀: upsertDocumentPreservingChunks 는 청크를 남긴다', async () => {
    await store.replaceDocument(DOC, [CHUNK]);

    await store.upsertDocumentPreservingChunks({ ...DOC, content: '둘째본문', title: '새 제목' });

    const doc = await store.getDocument('d1');
    expect(doc?.content).toBe('둘째본문');
    expect(doc?.title).toBe('새 제목');
    expect(await store.searchKeyword('첫번째본문이있다', 10)).toHaveLength(1);   // 청크가 살아 있다
  });

  it('★ 회귀: 그 갱신은 content_hash 를 비워 <다음 색인이 반드시 다시 굽게> 한다', async () => {
    // 새 해시를 써 버리면 다음 색인이 "변경 없음" 으로 건너뛰어 청크가 영원히 낡는다.
    await store.replaceDocument(DOC, [CHUNK]);
    await store.upsertDocumentPreservingChunks({ ...DOC, content: '둘째본문', contentHash: 'h2' });
    expect((await store.getDocument('d1'))?.contentHash).toBe('');
  });

  it('★ 회귀: replaceDocument 는 실패 시 <문서도 청크도> 되돌린다', async () => {
    await store.replaceDocument(DOC, [CHUNK]);
    await expect(store.replaceDocument(
      { ...DOC, content: '둘째', contentHash: 'h2' },
      [{ ...CHUNK, embedding: [1, 2] } as unknown as Chunk],     // 차원 불일치
    )).rejects.toThrow();

    expect((await store.getDocument('d1'))?.content).toBe('첫번째본문이있다');
    expect(await store.searchKeyword('첫번째본문이있다', 10)).toHaveLength(1);
  });
});

// 🔴 코덱스 8차 P1 — cascade 는 chunks 를 지우지만 <chunk_embeddings 는 못 지운다>.
//
// chunk_embeddings 는 vec0 <가상 테이블>이라 외래키에 참여하지 못한다. 그래서
// documents 의 INSERT OR REPLACE → cascade 로 chunks 가 사라지면, 임베딩은
// 가리킬 청크를 잃은 채 남는다. writeChunkRows 가 뒤늦게
// `chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)` 로 지우려 해도
// 청크가 이미 없어 <한 줄도 안 지워진다>.
//
// ★실볼트 실측 2026-08-21: 청크 39,125 / 임베딩 39,441 → <고아 317개>.
//   그동안 내 프로브는 "임베딩 없는 청크" 만 셌고(0건) <역방향을 안 봤다>.
//   한 방향만 재면 반대쪽 결함이 통째로 안 보인다.
describe('고아 임베딩을 남기지 않는다 (코덱스 8차 P1)', () => {
  let dir: string;
  let fileStore: VectorStore;
  let dbPath: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'orph-'));
    dbPath = join(dir, 'x.db');
    fileStore = createSqliteVecStore(dbPath, DIMS);
    await fileStore.initialize();
  });
  afterEach(async () => {
    await fileStore.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** 파일 DB 를 따로 열어 <조인이 아니라 실제 행 수>를 센다. */
  const orphanCount = (): number => {
    const db = new Database(dbPath, { readonly: true });
    sqliteVec.load(db);
    const n = db.prepare(
      'SELECT COUNT(*) n FROM chunk_embeddings e'
      + ' WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.id = e.chunk_id)',
    ).get() as { n: number };
    db.close();
    return n.n;
  };

  const chunkAt = (i: number, emb: number[]): Chunk => ({
    id: 'd1#' + i, documentId: 'd1', content: '본문' + i,
    heading: '', startLine: i, endLine: i + 1, tokenCount: 2, embedding: emb,
  } as unknown as Chunk);

  it('★ 회귀: 청크가 <줄어드는> 재색인이 옛 임베딩을 남기지 않는다', async () => {
    await fileStore.replaceDocument(DOC, [
      chunkAt(0, [1, 0, 0, 0]), chunkAt(1, [0, 1, 0, 0]), chunkAt(2, [0, 0, 1, 0]),
    ]);
    expect(orphanCount()).toBe(0);

    // 문서가 짧아져 청크가 1개로 준다 — 옛 id 2개는 새 집합에 없다.
    await fileStore.replaceDocument({ ...DOC, content: '짧아짐', contentHash: 'h2' },
      [chunkAt(0, [0, 0, 0, 1])]);

    expect(orphanCount()).toBe(0);      // ← 고치기 전에는 2 였다
  });

  it('★ 회귀: upsertDocument <단독>도 임베딩을 남기지 않는다', async () => {
    // 청크가 사라지는 것 자체는 SQLite 의 사실이다(위 시험이 못박는다).
    // 그렇더라도 <가리킬 곳 없는 임베딩>을 남겨서는 안 된다.
    await fileStore.replaceDocument(DOC, [chunkAt(0, [1, 0, 0, 0]), chunkAt(1, [0, 1, 0, 0])]);

    await fileStore.upsertDocument({ ...DOC, content: '둘째', contentHash: 'h2' });

    expect(orphanCount()).toBe(0);
  });

  it('★ 공개 export 인 자유 함수 upsertDocument 도 고아를 안 남긴다', async () => {
    // 🔴 저장소 안에 호출자가 <없어서> 아무 시험도 이 함수를 부르지 않았다. 그 상태로는
    //    같은 결함을 되살리는 변이가 살아남는다(실측: 변이 E1b GREEN).
    //    쓰는 사람이 없다고 안전한 것이 아니다 — store/index.ts 가 <공개로 내보낸다>.
    await fileStore.replaceDocument(DOC, [chunkAt(0, [1, 0, 0, 0]), chunkAt(1, [0, 1, 0, 0])]);

    const raw = new Database(dbPath);
    sqliteVec.load(raw);
    upsertDocumentRaw(raw, { ...DOC, content: '자유함수로갱신', contentHash: 'h9' });
    raw.close();

    expect(orphanCount()).toBe(0);
  });

  it('★ 청크를 보존하는 upsert 는 임베딩도 <그대로 둔다>', async () => {
    // 🔴 "고아를 0 으로" 를 `임베딩 전부 삭제` 로 달성하는 변이를 막는다.
    await fileStore.replaceDocument(DOC, [chunkAt(0, [1, 0, 0, 0]), chunkAt(1, [0, 1, 0, 0])]);

    await fileStore.upsertDocumentPreservingChunks({ ...DOC, content: '편집됨' });

    expect(orphanCount()).toBe(0);
    expect(await fileStore.searchKeyword('본문0', 10)).toHaveLength(1);
    const hits = await fileStore.searchSemantic([1, 0, 0, 0], 5);
    expect(hits.length).toBe(2);        // 임베딩 2개가 살아 있다
  });
});

// 🔴 코덱스 8차 P1 — ingest 라우터는 임베더가 없어 청크를 굽지 못한다. 그런 곳이
//    청크를 <지우는> 함수를 부르면, 이미 검색되던 문서가 다음 전체 색인 전까지 사라진다.
describe('청크를 못 굽는 호출부는 청크를 지우지 않는다 (코덱스 8차 P1)', () => {
  it('★ 회귀: upsertDocumentPreservingChunks 는 <없는 문서도 만든다>', async () => {
    // UPDATE 였다면 0행 갱신으로 조용히 사라졌을 것이다 — ingest 의 기본 경로가 그것이다.
    await store.upsertDocumentPreservingChunks({ ...DOC, id: 'new1', filePath: 'new1.md' });

    const got = await store.getDocument('new1');
    expect(got?.filePath).toBe('new1.md');
    expect(got?.contentHash).toBe('');   // 다음 색인이 다시 굽는다 (자가치유)
  });

  it('★ 회귀: 같은 id 로 다시 ingest 해도 이미 구운 청크가 살아남는다', async () => {
    await store.replaceDocument(DOC, [CHUNK]);
    expect(await store.searchKeyword('첫번째본문이있다', 10)).toHaveLength(1);

    // 같은 초·같은 제목 → savedTo 가 같다 → id 가 같다.
    await store.upsertDocumentPreservingChunks({ ...DOC, content: '다시 인제스트된 본문' });

    expect(await store.searchKeyword('첫번째본문이있다', 10)).toHaveLength(1);
    expect((await store.getDocument('d1'))?.content).toBe('다시 인제스트된 본문');
  });
});

// 🔴 코덱스 9차 P2 — <패치 전에 이미 생긴> 고아는 새 삭제식으로 영원히 안 잡힌다.
//    `chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)` 는 청크가 있는 것만
//    고르는데, 고아는 정의상 청크가 없다. 전체 재색인을 해도 남는다.
describe('예전에 쌓인 고아를 1회성으로 치운다 (코덱스 9차 P2)', () => {
  it('★ 회귀: runMaintenanceOnce 가 <청크 없는 임베딩>을 치운다', async () => {
    const dir2 = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'purge-'));
    const dbFile = join(dir2, 'x.db');
    const s1 = createSqliteVecStore(dbFile, DIMS);
    await s1.initialize();
    await s1.replaceDocument(DOC, [CHUNK]);

    // 패치 전 상태를 손으로 만든다: 청크만 지우고 임베딩은 남긴다.
    const raw = new Database(dbFile);
    sqliteVec.load(raw);
    raw.prepare('DELETE FROM chunks WHERE id = ?').run('d1#0');
    raw.prepare('DELETE FROM stellavault_meta WHERE key = ?').run('orphan_embedding_purge_v1');
    const before = raw.prepare(
      'SELECT COUNT(*) n FROM chunk_embeddings e WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.id = e.chunk_id)',
    ).get() as { n: number };
    raw.close();
    expect(before.n).toBe(1);
    await s1.close();

    // 🔴 <여는 것>만으로는 안 돈다 — 그 이동이 코덱스 12차 P1 의 수정이다.
    //    남의 DB 를 열어보기만 해도 행을 지우고 마커를 쓰던 자리였다.
    const s2 = createSqliteVecStore(dbFile, DIMS);
    await s2.initialize();
    const rawMid = new Database(dbFile);
    sqliteVec.load(rawMid);
    const mid = rawMid.prepare(
      'SELECT COUNT(*) n FROM chunk_embeddings e WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.id = e.chunk_id)',
    ).get() as { n: number };
    rawMid.close();
    expect(mid.n).toBe(1);                       // 아직 그대로다
    s2.runMaintenanceOnce();                     // 색인기가 소유를 확인한 뒤 부르는 그것
    await s2.close();

    const raw2 = new Database(dbFile, { readonly: true });
    sqliteVec.load(raw2);
    const after = raw2.prepare(
      'SELECT COUNT(*) n FROM chunk_embeddings e WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.id = e.chunk_id)',
    ).get() as { n: number };
    const marked = raw2.prepare('SELECT value FROM stellavault_meta WHERE key = ?')
      .get('orphan_embedding_purge_v1');
    raw2.close();

    expect(after.n).toBe(0);
    expect(marked).toBeTruthy();                 // 두 번 돌지 않는다

    try { rmSync(dir2, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
    catch { /* 윈도우 핸들 지연 — 무해 */ }
  });
});

// 🔴 코덱스 9차 P2 — 고아가 상위 k 를 채우면 <있는 결과를 없다고> 답하던 자리.
//
// searchSemantic 은 KNN 결과에 `JOIN chunks` 를 건다. 고아는 조인에서 전부 탈락하므로
// 바깥 결과가 0행이 되는데, grow() 는 그것을 "매치 없음" 으로 읽고 즉시 멈췄다.
// → 0행일 때는 <내부에 몇 개 있었는지>를 따로 물어 포화 여부를 판단한다.
describe('고아가 정상 결과를 가리지 않는다 (코덱스 9차 P2)', () => {
  it('★ 회귀: 상위 k 가 전부 고아여도 진짜 청크를 찾아낸다', async () => {
    const dir3 = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'hide-'));
    const dbFile = join(dir3, 'x.db');
    const st = createSqliteVecStore(dbFile, DIMS);
    await st.initialize();

    // 진짜 청크는 질의에서 <먼> 자리에 둔다.
    await st.replaceDocument(DOC, [{
      id: 'd1#0', documentId: 'd1', content: '진짜본문', heading: '',
      startLine: 0, endLine: 1, tokenCount: 2, embedding: [0, 0, 0, 1],
    } as unknown as Chunk]);

    // 질의에 <아주 가까운> 고아를 60개 심는다 — 초기 창(=10)을 통째로 채운다.
    const raw = new Database(dbFile);
    sqliteVec.load(raw);
    const ins = raw.prepare('INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)');
    const vec = Buffer.from(new Float32Array([1, 0, 0, 0]).buffer);
    raw.transaction(() => { for (let i = 0; i < 60; i++) ins.run('orphan#' + i, vec); })();
    const orphans = raw.prepare(
      'SELECT COUNT(*) n FROM chunk_embeddings e WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.id = e.chunk_id)',
    ).get() as { n: number };
    raw.close();
    expect(orphans.n).toBe(60);                    // 상황을 실제로 만들었다

    const hits = await st.searchSemantic([1, 0, 0, 0], 1);

    expect(hits.map(h => h.chunkId)).toEqual(['d1#0']);   // 고치기 전에는 [] 였다
    await st.close();
    try { rmSync(dir3, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
    catch { /* 윈도우 핸들 지연 — 무해 */ }
  });
});

describe('코덱스 11차 — 쓰기 전에 거절한다', () => {
  const DOC_A = {
    id: 'docA', filePath: 'a.md', title: 'a', content: '본문', frontmatter: {}, tags: [],
    lastModified: new Date(0).toISOString(), contentHash: 'ha',
  };
  const chunkOf = (docId: string, id: string) => ({
    id, documentId: docId, content: 'c', heading: null,
    startLine: 0, endLine: 1, tokenCount: 1, embedding: [1, 0, 0, 0],
  });

  it('★ replaceDocument(docA, chunksOfB) 는 <조용히 성공>하지 않는다', async () => {
    // writeChunkRows 는 대상 문서를 chunks[0].documentId 로 정한다. 검사가 없으면
    // 트랜잭션이 정상 커밋되면서 docA 는 청크 0 개가 되고 docB 가 교체된다 —
    // 예외도 로그도 없다 (코덱스 11차 P1).
    await expect(
      store.replaceDocument(DOC_A as never, [chunkOf('docB', 'docB#0') as never]),
    ).rejects.toThrow(/다른 문서/);
    expect(await store.getDocument('docA')).toBeFalsy();      // 부분 상태도 안 남는다
  });

  it('★ 임베딩 없는 청크는 <쓰지 않는다> — 검색에 영영 안 잡히기 때문이다', async () => {
    // searchSemantic 이 임베딩 → 청크 INNER JOIN 이라, 청크만 있으면 도달 경로가 없다.
    // 실볼트에서 실제로 그런 청크 1개를 찾았다 (2026-08-21, 판단-보정.md — 검색 0건).
    const naked = { ...chunkOf('docA', 'docA#0'), embedding: undefined };
    await expect(
      store.replaceDocument(DOC_A as never, [naked as never]),
    ).rejects.toThrow(/임베딩 없는 청크/);
    expect(await store.getDocument('docA')).toBeFalsy();
  });
});
