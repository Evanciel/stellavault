// 🔴 PUT /api/document/:id 로 편집하면 그 문서가 <검색에서 사라지던> 결함.
//
// 편집 경로는 store.upsertDocument 를 단독으로 불렀다. 그것은 INSERT OR REPLACE 라
// FK 의 ON DELETE CASCADE 가 그 문서의 청크를 전부 날리는데, 이 경로에는 임베더가 없어
// 다시 굽지 못한다. 게다가 이 서버(`stellavault graph`)에는 watcher 도 없어서
// 저절로 복구되지도 않는다 (코덱스 7차 P1, 2026-08-21).
//
// ★스토어에 안전한 메서드를 만드는 것만으로는 부족하다 — <호출부가 그걸 쓰는지>를 재야 한다.
//  실제로 스토어 시험만 있었을 때, 호출부를 되돌리는 변이가 살아남았다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import { createApiServer } from '../src/api/server.js';
import type { VectorStore } from '../src/store/types.js';
import type { Embedder } from '../src/indexer/embedder.js';

const DIMS = 4;
const PORT = 13347;
let store: VectorStore;
let server: ReturnType<typeof createApiServer>;
let vault: string;

const embedder: Embedder = {
  dimensions: DIMS, modelName: 'test',
  embed: async () => [0.5, 0.5, 0.5, 0.5],
  embedBatch: async (t: string[]) => t.map(() => [0.5, 0.5, 0.5, 0.5]),
};

beforeAll(async () => {
  vault = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'apiedit-'));
  writeFileSync(join(vault, 'note.md'), '---\ntitle: "노트"\n---\n\n최초본문이있다\n', 'utf-8');

  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();
  await store.replaceDocument(
    { id: 'doc1', filePath: 'note.md', title: '노트', content: '최초본문이있다',
      frontmatter: {}, tags: [], lastModified: '2026-01-01', contentHash: 'h1' },
    [{ id: 'doc1#0', documentId: 'doc1', content: '최초본문이있다', heading: '',
       startLine: 0, endLine: 1, tokenCount: 2, embedding: [1, 0, 0, 0] } as never],
  );

  server = createApiServer({ store, searchEngine: createSearchEngine({ store, embedder }), port: PORT, vaultPath: vault });
  await server.start();
});
afterAll(async () => {
  await server.stop?.();
  await store.close();
  rmSync(vault, { recursive: true, force: true });
});

describe('PUT /api/document/:id', () => {
  it('★ 회귀: 편집해도 그 문서가 <검색에서 사라지지> 않는다', async () => {
    expect(await store.searchKeyword('최초본문이있다', 10)).toHaveLength(1);

    // 토큰은 same-origin 브라우저 요청에만 내준다 — Origin 을 붙여 받아 온다.
    const origin = `http://127.0.0.1:${PORT}`;
    const tokenRes = await fetch(`${origin}/api/token`, { headers: { origin } });
    expect(tokenRes.ok).toBe(true);
    const { token } = await tokenRes.json() as { token: string };

    const res = await fetch(`${origin}/api/document/doc1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-stellavault-token': token },
      body: JSON.stringify({ content: '고친본문이있다' }),
    });
    expect(res.status).toBe(200);

    // 청크는 아직 낡았지만 <살아 있다>. 사라지는 것보다 낫다.
    expect(await store.searchKeyword('최초본문이있다', 10)).toHaveLength(1);
    // 그리고 다음 색인이 반드시 다시 굽도록 해시를 비웠다.
    expect((await store.getDocument('doc1'))?.contentHash).toBe('');
    expect((await store.getDocument('doc1'))?.content).toBe('고친본문이있다');
  });
});
