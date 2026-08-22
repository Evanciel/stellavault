// 🔴🔴 API 서버의 <쓰기 경로>가 소유 판정을 통째로 우회하던 결함 (코덱스 14차 P1).
//
// 색인기는 "각인이 어긋나면 한 글자도 안 쓴다" 고 약속하는데, `PUT /api/document/:id`
// · `DELETE /api/document/:id` · ingest 라우터는 그 판정을 거치지 않고 store 에 직접 썼다.
// `stellavault graph` 는 감시자 없이 API 만 띄우므로, 설정의 dbPath 가 남의 볼트를
// 가리키면 브라우저에서 노트를 하나 고치는 것만으로 그 DB 가 오염된다.
//
// ★가드는 <허용목록>이다. 한때 <메서드별>이었는데 그것이 틀렸다 (코덱스 15차 P1):
//  `GET /api/search` 와 `GET /api/document/:id` 는 `recordAccess` 로 DB 에 쓰고,
//  `GET /api/decay`·`GET /api/heatmap` 은 `computeAll` 로 `decay_state` 를 갱신한다.
//  ★HTTP 메서드는 부작용의 증거가 아니다. 그래서 fail-closed 로 뒤집었고, 이 시험도 뒤집는다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve as resolvePath } from 'node:path';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import { createApiServer } from '../src/api/server.js';
import { DecayEngine } from '../src/intelligence/decay-engine.js';
import { VAULT_OWNER_KEY } from '../src/store/vault-ownership.js';
import type { VectorStore } from '../src/store/types.js';
import type { Embedder } from '../src/indexer/embedder.js';

const DIMS = 4;
const PORT = 13357;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let store: VectorStore;
let server: ReturnType<typeof createApiServer>;
let vault: string;
let token: string;

const embedder: Embedder = {
  dimensions: DIMS, modelName: 'test',
  embed: async () => [0.5, 0.5, 0.5, 0.5],
  embedBatch: async (t: string[]) => t.map(() => [0.5, 0.5, 0.5, 0.5]),
};

const put = (body: unknown) => fetch(`${ORIGIN}/api/document/abc/edit`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', 'x-stellavault-token': token },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  vault = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'apifgn-'));
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

describe('API 쓰기 경로 — 남의 DB 에는 쓰지 않는다 (코덱스 14차 P1)', () => {
  it('★ 각인이 <없으면> 통과한다 — 안 그러면 reindex 가 막혀 각인될 길이 사라진다', async () => {
    store.setMeta(VAULT_OWNER_KEY, '');
    const res = await put({ title: 'x' });
    // 404(문서 없음)든 다른 것이든, <409 는 아니어야> 한다.
    expect(res.status).not.toBe(409);
  });

  it('★ 각인이 <어긋나면> 쓰기가 409 로 거부된다', async () => {
    store.setMeta(VAULT_OWNER_KEY, resolvePath('C:/전혀/다른/볼트'));
    const res = await put({ title: 'x' });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain('다른 볼트');
  });

  it('★ 같은 상태에서도 <읽기>는 막지 않는다 — 거부는 쓰기에만 건다', async () => {
    store.setMeta(VAULT_OWNER_KEY, resolvePath('C:/전혀/다른/볼트'));
    const res = await fetch(`${ORIGIN}/api/stats`, { headers: { origin: ORIGIN } });
    expect(res.status).not.toBe(409);
  });

  it('★ 허용목록 밖은 <새 라우트도> 막힌다 — 기본이 거부라야 조용히 안 빠진다', async () => {
    // 이 경로는 존재하지 않는다. 라우트마다 가드를 붙였다면 404 가 났을 것이다.
    // 409 가 나온다는 것은 <가드가 라우팅보다 앞에> 있다는 뜻이다.
    store.setMeta(VAULT_OWNER_KEY, resolvePath('C:/전혀/다른/볼트'));
    const res = await fetch(`${ORIGIN}/api/아직-없는-쓰기-경로`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stellavault-token': token },
      body: '{}',
    });
    expect(res.status).toBe(409);
  });

  it('★★ <DB 에 쓰는 GET> 도 막힌다 — 메서드 기반 가드가 통과시키던 바로 그 구멍', async () => {
    // `/api/search` 는 GET 이지만 `recordAccess` 로 decay_state 에 쓴다.
    store.setMeta(VAULT_OWNER_KEY, resolvePath('C:/전혀/다른/볼트'));
    const res = await fetch(`${ORIGIN}/api/search?q=hello`, { headers: { origin: ORIGIN } });
    expect(res.status).toBe(409);
  });

  it('★ `/api/document/:id` 도 GET 이지만 쓴다 — 같이 막힌다', async () => {
    store.setMeta(VAULT_OWNER_KEY, resolvePath('C:/전혀/다른/볼트'));
    const res = await fetch(`${ORIGIN}/api/document/abc`, { headers: { origin: ORIGIN } });
    expect(res.status).toBe(409);
  });

  it('★ 허용목록의 경로는 <각인이 어긋나도> 열린다 — 상태를 보여줄 창구는 남긴다', async () => {
    store.setMeta(VAULT_OWNER_KEY, resolvePath('C:/전혀/다른/볼트'));
    for (const p of ['/api/stats', '/api/reindex/status', '/api/graph/status']) {
      const res = await fetch(`${ORIGIN}${p}`, { headers: { origin: ORIGIN } });
      expect(res.status, p).not.toBe(409);
    }
  });

  it('★ 각인을 <다시 맞추면> 곧바로 통과한다 — 판정을 캐시하지 않는다', async () => {
    store.setMeta(VAULT_OWNER_KEY, resolvePath('C:/전혀/다른/볼트'));
    expect((await put({ title: 'x' })).status).toBe(409);

    store.setMeta(VAULT_OWNER_KEY, resolvePath(vault));
    expect((await put({ title: 'x' })).status).not.toBe(409);
  });
});

// 🔴 각인을 <물어볼 수 없을> 때. 한때 여기서 통과시키며 "막으면 읽기까지 죽는다" 고
//    적었는데 둘 다 틀렸다 — 읽기는 허용목록에서 이미 빠지고, 각인 없음은 예외가
//    아니라 정상 반환이다. 판정 불가를 통과로 바꾸면 그것은 <가드 모양의 통로>다.
describe('소유를 물을 수 없으면 거부한다 (코덱스 15차 P2)', () => {
  const PORT2 = 13358;
  const ORIGIN2 = `http://127.0.0.1:${PORT2}`;
  let s2: VectorStore;
  let srv2: ReturnType<typeof createApiServer>;
  let v2: string;

  beforeAll(async () => {
    v2 = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'apifgn2-'));
    const real = createSqliteVecStore(':memory:', DIMS);
    await real.initialize();
    s2 = new Proxy(real, {
      get(t, k, rcv) {
        if (k === 'getMeta') return () => { throw new Error('각인을 못 읽는다'); };
        return Reflect.get(t, k, rcv);
      },
    }) as VectorStore;
    srv2 = createApiServer({
      store: s2, searchEngine: createSearchEngine({ store: s2, embedder }), port: PORT2, vaultPath: v2,
    });
    await srv2.start();
  });
  afterAll(async () => {
    await srv2.stop?.();
    rmSync(v2, { recursive: true, force: true });
  });

  it('★ getMeta 가 던지면 쓰기를 거부한다 — 판정 불가는 통과가 아니다', async () => {
    const res = await fetch(`${ORIGIN2}/api/document/abc/edit`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(409);
  });

  it('★ 그래도 허용목록은 열린다 — 상태를 볼 창구까지 닫지는 않는다', async () => {
    const res = await fetch(`${ORIGIN2}/api/graph/status`, { headers: { origin: ORIGIN2 } });
    expect(res.status).not.toBe(409);
  });
});

// 🔴🔴 허용목록은 <주장>이다 — 그 주장을 실제로 잰다 (코덱스 16차 P1).
//
//   15차에 메서드 기반 가드를 허용목록으로 뒤집으며 "HTTP 메서드는 부작용의 증거가
//   아니다" 라고 적었다. 그러고는 그 목록을 <경로 이름을 보고> 채웠다. `/api/health` 를
//   "프로세스 상태" 라고 적어 넣었는데, 그 핸들러는 `decayEngine.computeAll()` 로
//   `decay_state` 에 INSERT/UPDATE 한다. ★이름도 부작용의 증거가 아니다.
//
//   그래서 목록을 <때려 본다>. 어긋난 각인을 세운 DB 에 허용목록의 모든 경로를 요청하고,
//   그 전후로 쓰기가 생기는 표들의 행 수를 비교한다. 새 경로를 이름만 보고 넣으면
//   이 시험이 빨개진다 — 그것이 이 파일이 존재하는 이유다.
describe('허용목록의 <모든> 경로가 정말로 DB 에 안 쓴다 (코덱스 16차 P1)', () => {
  const PORT3 = 13359;
  const ORIGIN3 = `http://127.0.0.1:${PORT3}`;
  let s3: VectorStore;
  let srv3: ReturnType<typeof createApiServer>;
  let v3: string;
  let tok3: string;

  // 🔴 서버 소스에서 목록을 <읽어 온다>. 여기 손으로 다시 적으면 두 곳이 갈리고,
  //    새로 추가된 경로는 영영 안 재게 된다 — 이 사고의 모양 그대로다.
  function allowList(): string[] {
    const src = readFileSync(
      join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'api', 'server.ts'), 'utf-8');
    const block = /SAFE_ON_FOREIGN_DB[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src);
    if (!block) throw new Error('허용목록을 server.ts 에서 못 찾았다 — 이 시험이 눈이 멀었다');
    return [...block[1].matchAll(/'(\/api\/[^']+)'/g)].map(m => m[1]);
  }

  /** 쓰기가 일어나면 늘어나는 표들의 행 수 합. */
  function writeFootprint(store: VectorStore): string {
    const db = (store as unknown as { getDb(): { prepare(q: string): { get(): unknown } } }).getDb();
    const count = (t: string) => {
      try { return Object.values(db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as object)[0]; }
      catch { return 'no-table'; }
    };
    return ['documents', 'chunks', 'access_log', 'decay_state', 'stellavault_meta']
      .map(t => `${t}=${count(t)}`).join(' ');
  }

  beforeAll(async () => {
    v3 = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'apifgn3-'));
    s3 = createSqliteVecStore(':memory:', DIMS);
    await s3.initialize();
    // 🔴🔴 `decayEngine` 을 <반드시> 붙인다 (2026-08-22 실측으로 알았다).
    //    안 붙이면 `/api/health` 가 `if (decayEngine)` 에서 그냥 건너뛰어 <아무것도 안 쓴다>.
    //    즉 이 시험은 초록인데 실서버는 쓴다 — 정확히 <거짓 초록>이다.
    //    ★변이(허용목록에 /api/health 재추가)를 심었을 때 이 시험이 <안 빨개진 것>이 단서였다.
    //     이름을 박아 둔 아래 시험만 잡았는데, 그것은 다음에 추가될 경로는 못 잡는다.
    //    ⚠️ 그러므로 서버가 <선택적으로> 받는 협력자를 이 시험은 전부 붙여야 한다.
    //       안 붙이면 그 협력자를 쓰는 쓰기 경로가 통째로 안 보인다.
    srv3 = createApiServer({
      store: s3, searchEngine: createSearchEngine({ store: s3, embedder }), port: PORT3, vaultPath: v3,
      decayEngine: new DecayEngine(
        (s3 as unknown as { getDb(): ConstructorParameters<typeof DecayEngine>[0] }).getDb()),
    });
    await srv3.start();
    tok3 = ((await (await fetch(`${ORIGIN3}/api/token`, { headers: { origin: ORIGIN3 } })).json()) as
      { token: string }).token;

    // 🔴🔴 문서를 <한 건 넣는다>. 이것 없이는 이 시험이 또 눈이 먼다 (2026-08-22 실측).
    //    `computeAll()` 도 `recordAccess` 도 <문서를 돌며> 쓴다. 빈 DB 에서는 순회가
    //    0회라 아무것도 안 쓰고, 그러면 쓰는 경로를 허용목록에 넣어도 이 시험이 초록이다.
    //    ★변이를 심었더니 이름 박은 시험만 잡고 이 일반 시험은 통과했다 — 두 번째 단서였다.
    //     (첫 번째는 decayEngine 미주입.) <협력자도 데이터도 있어야> 쓰기가 재현된다.
    await s3.upsertDocument({
      id: 'probe1', filePath: 'probe.md', title: '탐침',
      content: '이 문서가 없으면 decay 순회가 0회다', frontmatter: {}, tags: [],
      lastModified: '2026-01-01', contentHash: 'h-probe',
    });
    await s3.upsertChunks([{
      id: 'probe1#0', documentId: 'probe1', content: '이 문서가 없으면 decay 순회가 0회다',
      heading: '탐침', startLine: 1, endLine: 1, tokenCount: 8, embedding: [1, 0, 0, 0],
    }]);

    // 이 DB 는 <남의 것>이다.
    s3.setMeta(VAULT_OWNER_KEY, resolvePath('C:/전혀/다른/볼트'));
  });
  afterAll(async () => {
    await srv3.stop?.();
    await s3.close();
    rmSync(v3, { recursive: true, force: true });
  });

  it('★ 목록을 실제로 읽어 왔다 — 0개면 아래 시험이 <공회전>이다', () => {
    expect(allowList().length).toBeGreaterThan(2);
  });

  it('★★ 허용목록의 모든 경로를 때려도 DB 행 수가 <그대로다>', async () => {
    const before = writeFootprint(s3);
    const touched: string[] = [];
    for (const p of allowList()) {
      const res = await fetch(`${ORIGIN3}${p}`, {
        headers: { origin: ORIGIN3, 'x-stellavault-token': tok3 },
      });
      // 허용목록이니 409 는 아니어야 한다(그래야 실제로 <실행돼서> 쓰는지 볼 수 있다).
      expect(res.status, `${p} 가 가드에 막혔다 — 목록에 있는데?`).not.toBe(409);
      touched.push(p);
      expect(writeFootprint(s3), `${p} 가 DB 에 썼다 — 허용목록에서 빼라`).toBe(before);
    }
    expect(touched.length).toBeGreaterThan(2);
  });

  it('★ `/api/health` 는 목록에 <없다> — decayEngine.computeAll() 로 쓴다', () => {
    expect(allowList()).not.toContain('/api/health');
  });
});
