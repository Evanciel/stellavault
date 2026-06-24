import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import { createApiServer } from '../src/api/server.js';
import type { VectorStore } from '../src/store/types.js';
import type { Embedder } from '../src/indexer/embedder.js';

// 회귀 테스트: POST /api/ingest의 SSRF 가드가 YouTube 분기까지 보호하는지 검증.
// isYouTube는 입력 전체를 substring 매칭(/youtube\.com\/watch|youtu\.be\//)하므로
// http://169.254.169.254/youtu.be/ 같은 내부/메타데이터 타깃이 YouTube 추출 경로로
// 새어 들어가 unguarded fetch에 도달할 수 있었다. 가드를 youtube/else 분기 이전으로
// hoist한 뒤에는 어떤 http 입력이든 fetch 이전에 차단되어 400을 반환해야 한다.

const DIMS = 4;
let store: VectorStore;
let server: ReturnType<typeof createApiServer>;
const PORT = 13399; // api-routes.test.ts(13333)와 충돌하지 않는 전용 포트
const ORIGIN = `http://127.0.0.1:${PORT}`; // CORS allow-list에 포함 → /api/token 발급 가능

function mockEmbedder(): Embedder {
  return {
    dimensions: DIMS, modelName: 'test',
    initialize: async () => {},
    embed: async () => [0.5, 0.5, 0.5, 0.5],
    embedBatch: async (texts) => texts.map(() => [0.5, 0.5, 0.5, 0.5]),
  };
}

// /api/token은 createApiServer가 반환하지 않으므로, same-origin 브라우저 요청을
// 흉내내(Origin 헤더) 토큰을 1회 수령한다.
async function fetchToken(): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/token`, {
    headers: { Origin: ORIGIN },
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(typeof data.token).toBe('string');
  return data.token;
}

async function postIngest(token: string, input: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/api/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Stellavault-Token': token,
    },
    body: JSON.stringify({ input }),
  });
}

beforeAll(async () => {
  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();

  const embedder = mockEmbedder();
  const searchEngine = createSearchEngine({ store, embedder });
  server = createApiServer({ store, searchEngine, port: PORT });
  await server.start();
});

afterAll(async () => { await store.close(); });

describe('POST /api/ingest — SSRF guard (youtube branch)', () => {
  it('REJECT: http://169.254.169.254/youtu.be/ (cloud metadata via youtube substring) → 400', async () => {
    const token = await fetchToken();
    const res = await postIngest(token, 'http://169.254.169.254/youtu.be/');
    expect(res.status).toBe(400);
  });

  it('REJECT: http://10.0.0.1/ (RFC1918 literal) → 400', async () => {
    const token = await fetchToken();
    const res = await postIngest(token, 'http://10.0.0.1/');
    expect(res.status).toBe(400);
  });
});
