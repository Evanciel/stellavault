// 🔴 POST /api/ingest 가 <이미 구워진 청크를 날리던> 결함 (코덱스 8차 P1).
//
// 이 라우터에는 임베더가 없다 — 구조적으로 청크를 굽지 못한다. 그런데도
// store.upsertDocument 를 단독으로 불렀다. 그것은 INSERT OR REPLACE 라
// FK 의 ON DELETE CASCADE 가 그 문서의 청크를 전부 날린다.
// 같은 초·같은 제목을 다시 ingest 하면 savedTo 가 같고 → id 가 같고 →
// <이미 검색되던 문서가 다음 전체 색인 전까지 사라진다>.
// ★`stellavault graph` 는 watcher 없이 API 만 띄우므로 그 "다음" 이 안 올 수 있다.
//
// ★스토어에 안전한 메서드를 두는 것으로는 부족하다 — <라우터가 그걸 쓰는지>를 잰다.
//  chunk-preservation.test.ts 는 스토어만 재므로, 라우터를 되돌리는 변이를 못 잡는다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import { createApiServer } from '../src/api/server.js';
import type { VectorStore } from '../src/store/types.js';
import type { Embedder } from '../src/indexer/embedder.js';

const DIMS = 4;
const PORT = 13351;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TITLE = '중복 인제스트 시험 노트';
const BODY = '이미구운본문이있다. '.repeat(8);

let store: VectorStore;
let server: ReturnType<typeof createApiServer>;
let vault: string;
let token: string;

const embedder: Embedder = {
  dimensions: DIMS, modelName: 'test',
  embed: async () => [0.5, 0.5, 0.5, 0.5],
  embedBatch: async (t: string[]) => t.map(() => [0.5, 0.5, 0.5, 0.5]),
};

const idOf = (savedTo: string) => createHash('sha256').update(savedTo).digest('hex').slice(0, 16);

async function postIngest(): Promise<string> {
  const res = await fetch(`${ORIGIN}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-stellavault-token': token },
    body: JSON.stringify({ input: BODY, title: TITLE, stage: 'fleeting' }),
  });
  expect(res.status).toBe(200);
  const body = await res.json() as { savedTo: string };
  return body.savedTo;
}

beforeAll(async () => {
  vault = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'apiing-'));
  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();
  server = createApiServer({
    store, searchEngine: createSearchEngine({ store, embedder }), port: PORT, vaultPath: vault,
  });
  await server.start();
  const tokenRes = await fetch(`${ORIGIN}/api/token`, { headers: { origin: ORIGIN } });
  token = ((await tokenRes.json()) as { token: string }).token;
});
afterAll(async () => {
  await server.stop?.();
  await store.close();
  rmSync(vault, { recursive: true, force: true });
});

describe('POST /api/ingest', () => {
  it('★ 회귀: 같은 id 로 다시 ingest 해도 <이미 구운 청크>가 살아남는다', async () => {
    const savedTo = await postIngest();
    const id = idOf(savedTo);

    // 색인기가 나중에 구운 상태를 만든다.
    await store.replaceDocument(
      { id, filePath: savedTo, title: TITLE, content: '이미구운본문이있다',
        frontmatter: {}, tags: [], lastModified: '2026-01-01', contentHash: 'h1' },
      [{ id: id + '#0', documentId: id, content: '이미구운본문이있다', heading: '',
         startLine: 0, endLine: 1, tokenCount: 2, embedding: [1, 0, 0, 0] } as never],
    );
    expect(await store.searchKeyword('이미구운본문이있다', 10)).toHaveLength(1);

    // 파일명은 초 단위라(ingest-pipeline: slice(0,19)) 같은 초에 다시 보내면 id 가 같다.
    // 🔴 초 경계에 걸리면 조용히 다른 문서가 되어 시험이 <의미를 잃는다> — 그래서
    //    조용히 넘기지 않고, 못 맞추면 명시적으로 실패시킨다.
    let hit = '';
    for (let i = 0; i < 8 && hit !== savedTo; i++) hit = await postIngest();
    expect(hit, '같은 초 안에 두 번 ingest 하지 못했다 — 시험이 성립하지 않는다').toBe(savedTo);

    // 라우터가 청크를 보존하는 경로를 썼다면 여전히 검색된다.
    expect(await store.searchKeyword('이미구운본문이있다', 10)).toHaveLength(1);
    // 그리고 다음 색인이 반드시 다시 굽도록 해시를 비웠다.
    expect((await store.getDocument(id))?.contentHash).toBe('');
  });

  it('★ 처음 보는 문서는 <행이 새로 생긴다> — UPDATE 로 되돌리면 사라진다', async () => {
    const savedTo = await postIngest();
    const got = await store.getDocument(idOf(savedTo));
    expect(got?.filePath).toBe(savedTo);
  });
});

// 🔴 변이 E5 가 여기 없이는 <살아남았다> — /api/ingest/file 을 부르는 시험이 하나도 없었다.
//    같은 결함이 두 라우터에 있었는데 한쪽만 재고 있었다. 그 상태로는 파일 업로드 쪽을
//    upsertDocument 로 되돌려도 전부 초록이다.
describe('POST /api/ingest/file', () => {
  async function postFile(name: string): Promise<string> {
    const fd = new FormData();
    fd.append('file', new Blob([BODY], { type: 'text/markdown' }), name);
    const res = await fetch(`${ORIGIN}/api/ingest/file`, {
      method: 'POST',
      headers: { 'x-stellavault-token': token },
      body: fd,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { savedTo: string }).savedTo;
  }

  it('★ 회귀: 같은 파일을 다시 올려도 <이미 구운 청크>가 살아남는다', async () => {
    const savedTo = await postFile('업로드시험.md');
    const id = idOf(savedTo);

    await store.replaceDocument(
      { id, filePath: savedTo, title: '업로드시험', content: '업로드된본문이있다',
        frontmatter: {}, tags: [], lastModified: '2026-01-01', contentHash: 'h1' },
      [{ id: id + '#0', documentId: id, content: '업로드된본문이있다', heading: '',
         startLine: 0, endLine: 1, tokenCount: 2, embedding: [1, 0, 0, 0] } as never],
    );
    expect(await store.searchKeyword('업로드된본문이있다', 10)).toHaveLength(1);

    let hit = '';
    for (let i = 0; i < 8 && hit !== savedTo; i++) hit = await postFile('업로드시험.md');
    expect(hit, '같은 초 안에 두 번 업로드하지 못했다 — 시험이 성립하지 않는다').toBe(savedTo);

    expect(await store.searchKeyword('업로드된본문이있다', 10)).toHaveLength(1);
    expect((await store.getDocument(id))?.contentHash).toBe('');
  });
});
