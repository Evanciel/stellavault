// B4 — 어휘·의미 후보 리스트의 문서당 다양성 상한.
//
// 왜 있나: B2.1 이 엔티티 신호에만 상한을 달았고 나머지 둘은 무방비였다. 실측
// (2026-08-20, 69k 청크 볼트) — 템플릿 노트 163장이 청크 7,552개(전체 10.9%)를
// 차지해 최종 top-30 을 30/30 으로 채웠고, 정답은 BM25 <1위>인데도 융합 풀에
// 들어가지 못했다. RRF 는 순위로 더하므로 후보 풀에서 밀려나면 그 신호가 통째로 0 이다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteVecStore, grow } from '../src/store/sqlite-vec.js';
import type { VectorStore } from '../src/store/types.js';
import { createSearchEngine } from '../src/search/index.js';
import type { Embedder } from '../src/indexer/embedder.js';

const DIMS = 4;
let store: VectorStore;

beforeEach(async () => {
  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();
});
afterEach(async () => { await store.close(); });

async function doc(id: string, filePath: string) {
  await store.upsertDocument({
    id, filePath, title: id, content: '', frontmatter: {},
    tags: [], lastModified: '2026-01-01', contentHash: 'h-' + id,
  });
}

describe('문서당 다양성 상한 — searchKeyword (BM25)', () => {
  it('한 문서가 여러 청크로 매치해도 2개까지만 낸다', async () => {
    await doc('flood', 'flood.md');
    await store.upsertChunks(Array.from({ length: 6 }, (_, i) => ({
      id: `flood#${i}`, documentId: 'flood', content: 'gateway telemetry payload',
      heading: '', startLine: 0, endLine: 1, tokenCount: 3, embedding: [0.1, 0.1, 0.1, 0.1],
    })));

    const r = await store.searchKeyword('telemetry', 30);
    expect(r.length).toBe(2);
  });

  it('★ 회귀: 넘치는 문서가 <다른 문서>를 후보 풀 밖으로 밀어내지 못한다', async () => {
    // 넘치는 쪽은 40청크, 정답은 1청크. 상한이 없으면 limit=5 를 flood 가 다 먹는다.
    await doc('flood', 'inbox/templated.md');
    await store.upsertChunks(Array.from({ length: 40 }, (_, i) => ({
      id: `flood#${i}`, documentId: 'flood', content: 'gateway telemetry payload',
      heading: '', startLine: 0, endLine: 1, tokenCount: 3, embedding: [0.1, 0.1, 0.1, 0.1],
    })));
    await doc('answer', 'knowledge/answer.md');
    await store.upsertChunks([{
      id: 'answer#0', documentId: 'answer', content: 'telemetry',
      heading: '', startLine: 0, endLine: 1, tokenCount: 1, embedding: [0.9, 0.9, 0.9, 0.9],
    }]);

    const ids = (await store.searchKeyword('telemetry', 5)).map(x => x.chunkId);
    expect(ids).toContain('answer#0');
    expect(ids.filter(i => i.startsWith('flood#')).length).toBe(2);
  });
});

describe('문서당 다양성 상한 — searchSemantic (KNN)', () => {
  it('한 문서가 KNN 상위를 독점해도 2개까지만 낸다', async () => {
    await doc('flood', 'flood.md');
    await store.upsertChunks(Array.from({ length: 6 }, (_, i) => ({
      id: `flood#${i}`, documentId: 'flood', content: 'x',
      heading: '', startLine: 0, endLine: 1, tokenCount: 1,
      embedding: [1, 0, 0, 0.001 * i],   // 질의 벡터에 전부 아주 가깝다
    })));

    const r = await store.searchSemantic([1, 0, 0, 0], 30);
    expect(r.length).toBe(2);
  });

  it('★ 회귀: 가까운 청크 40개를 가진 문서가 먼 문서의 자리를 다 뺏지 못한다', async () => {
    await doc('flood', 'inbox/templated.md');
    await store.upsertChunks(Array.from({ length: 40 }, (_, i) => ({
      id: `flood#${i}`, documentId: 'flood', content: 'x',
      heading: '', startLine: 0, endLine: 1, tokenCount: 1,
      embedding: [1, 0, 0, 0.0001 * i],
    })));
    await doc('answer', 'knowledge/answer.md');
    await store.upsertChunks([{
      id: 'answer#0', documentId: 'answer', content: 'y',
      heading: '', startLine: 0, endLine: 1, tokenCount: 1, embedding: [0.9, 0.1, 0, 0],
    }]);

    const ids = (await store.searchSemantic([1, 0, 0, 0], 5)).map(x => x.chunkId);
    expect(ids).toContain('answer#0');
    expect(ids.filter(i => i.startsWith('flood#')).length).toBe(2);
  });
});

describe('상한이 정상 결과를 깎지 않는다', () => {
  it('문서가 여럿이면 limit 만큼 채운다', async () => {
    for (let d = 0; d < 8; d++) {
      await doc(`d${d}`, `d${d}.md`);
      await store.upsertChunks([{
        id: `d${d}#0`, documentId: `d${d}`, content: 'telemetry',
        heading: '', startLine: 0, endLine: 1, tokenCount: 1,
        embedding: [1, 0, 0, 0.01 * d],
      }]);
    }
    expect((await store.searchKeyword('telemetry', 8)).length).toBe(8);
    expect((await store.searchSemantic([1, 0, 0, 0], 8)).length).toBe(8);
  });
});

// 🔴 코덱스 P1 (2026-08-21): 고정 배수 과다인출은 결과 개수를 보장하지 못한다.
//    limit=5 · overfetch 10 → 안쪽 창이 50개인데 한 문서가 51청크를 가지면
//    창이 통째로 그 문서로 채워지고, 상한 적용 후 <2개>만 남는다.
//    뒤에 멀쩡한 문서가 몇이든 결과에 못 들어온다.
describe('★ 회귀: 과다인출 창을 한 문서가 독식해도 limit 을 채운다', () => {
  const FLOOD = 60;      // limit(5) * OVERFETCH(10) = 50 보다 크다
  const OTHERS = 6;

  beforeEach(async () => {
    await doc('flood', 'inbox/templated.md');
    await store.upsertChunks(Array.from({ length: FLOOD }, (_, i) => ({
      // BM25 는 <같은 내용>이면 순위가 같고, 동점은 chunk_id 로 갈린다.
      // 'flood#…' < 'o0#0' 이므로 넘치는 쪽이 안쪽 창을 통째로 먹는다 — 그것이 재현 조건이다.
      id: `flood#${i}`, documentId: 'flood', content: 'telemetry',
      heading: '', startLine: 0, endLine: 1, tokenCount: 1,
      embedding: [1, 0, 0, 0.000001 * i],          // 질의에 가장 가깝다
    })));
    for (let d = 0; d < OTHERS; d++) {
      await doc(`o${d}`, `knowledge/o${d}.md`);
      await store.upsertChunks([{
        id: `o${d}#0`, documentId: `o${d}`, content: 'telemetry',
        heading: '', startLine: 0, endLine: 1, tokenCount: 1,
        embedding: [0.9, 0.1, 0, 0.001 * d],       // 더 멀다 = KNN 뒤쪽
      }]);
    }
  });

  it('searchKeyword — 5개를 채운다', async () => {
    const ids = (await store.searchKeyword('telemetry', 5)).map(x => x.chunkId);
    expect(ids.length).toBe(5);
    expect(ids.filter(i => i.startsWith('flood#')).length).toBe(2);
  });

  it('searchSemantic — 5개를 채운다', async () => {
    const ids = (await store.searchSemantic([1, 0, 0, 0], 5)).map(x => x.chunkId);
    expect(ids.length).toBe(5);
    expect(ids.filter(i => i.startsWith('flood#')).length).toBe(2);
  });
});

// 🔴 코덱스 2차 P1 (2026-08-21): 창을 넓혔는데 <결과 수가 그대로>인 것을
//    "후보 소진" 으로 읽으면 거기서 멈춘다. 한 문서가 250청크를 독식하면
//    창 50 과 200 이 똑같이 2건이라, 뒤에 있는 멀쩡한 문서를 영원히 못 본다.
//    앞의 FLOOD=60 시험은 첫 확대(200)에서 다른 문서가 나와 이 결함을 못 잡았다.
describe('★ 회귀: 창을 넓혀도 결과가 그대로일 때 <멈추지> 않는다', () => {
  const FLOOD = 250;     // 첫 창 50, 첫 확대 200 — 둘 다 이 문서로만 찬다
  const OTHERS = 6;

  beforeEach(async () => {
    await doc('flood', 'inbox/templated.md');
    await store.upsertChunks(Array.from({ length: FLOOD }, (_, i) => ({
      id: `flood#${String(i).padStart(4, '0')}`, documentId: 'flood', content: 'telemetry',
      heading: '', startLine: 0, endLine: 1, tokenCount: 1,
      embedding: [1, 0, 0, 0.0000001 * i],
    })));
    for (let d = 0; d < OTHERS; d++) {
      await doc(`o${d}`, `knowledge/o${d}.md`);
      await store.upsertChunks([{
        id: `o${d}#0`, documentId: `o${d}`, content: 'telemetry',
        heading: '', startLine: 0, endLine: 1, tokenCount: 1,
        embedding: [0.9, 0.1, 0, 0.001 * d],
      }]);
    }
  });

  it('searchKeyword — 5개를 채운다', async () => {
    const ids = (await store.searchKeyword('telemetry', 5)).map(x => x.chunkId);
    expect(ids.length).toBe(5);
    expect(ids.filter(i => i.startsWith('flood#')).length).toBe(2);
  });

  it('searchSemantic — 5개를 채운다', async () => {
    const ids = (await store.searchSemantic([1, 0, 0, 0], 5)).map(x => x.chunkId);
    expect(ids.length).toBe(5);
    expect(ids.filter(i => i.startsWith('flood#')).length).toBe(2);
  });

  it('후보가 정말 없으면 있는 만큼만 낸다 (판별력 — 무한확대가 아니다)', async () => {
    // 문서 7개 · 상한 2 → 최대 8건. limit 50 을 달라 해도 8건이 끝이다.
    const ids = await store.searchKeyword('telemetry', 50);
    expect(ids.length).toBe(2 + OTHERS);
  });
});

// grow() 를 직접 겨눈다 — 창 확대 정책은 SQL 밖의 순수 함수라 이렇게 재는 것이 정확하다.
describe('grow() — 창 확대 정책', () => {
  const rowsOf = (n: number, innerN: number) =>
    Array.from({ length: n }, (_, i) => ({ id: i, inner_n: innerN }));

  it('★ 회귀: 첫 창도 천장을 넘지 않는다', () => {
    // limit*OVERFETCH 가 이미 천장보다 크면 첫 질의부터 선언한 상한을 어긴다.
    // federation 은 peer 의 limit 을 검증 없이 넘기므로 원격에서 비용 제한을 우회한다
    // (코덱스 2차 P2, 2026-08-21).
    const asked: number[] = [];
    grow(5000, 4096, w => { asked.push(w); return rowsOf(1, w); }, 10);
    expect(Math.max(...asked)).toBeLessThanOrEqual(4096);
  });

  it('결과가 모자라고 창이 포화면 넓힌다', () => {
    const asked: number[] = [];
    grow(50, 4096, w => { asked.push(w); return rowsOf(2, w); }, 5);   // 언제나 포화
    expect(asked).toEqual([50, 200, 800, 3200, 4096]);
  });

  it('창이 포화가 아니면 더 넓히지 않는다', () => {
    const asked: number[] = [];
    grow(50, 4096, w => { asked.push(w); return rowsOf(2, 7); }, 5);   // 안쪽 7건뿐
    expect(asked).toEqual([50]);
  });

  it('매치가 아예 없으면 한 번만 묻는다', () => {
    const asked: number[] = [];
    grow(50, 4096, w => { asked.push(w); return rowsOf(0, 0); }, 5);
    expect(asked).toEqual([50]);
  });
});

// 🔴 코덱스 6b — 여기 시험들이 <저장소 계층만> 재고 있었다 (2026-08-21).
//
// 실제 사고는 "정답이 BM25 1위인데도 최종 결과에 없다" 였다. 그런데 이 파일은
// store.searchKeyword/searchSemantic 을 직접 부를 뿐 <융합 검색을 부르지 않아서>,
// 호출자가 후보 요청량을 되돌리는 변이(FETCH_LIMIT 30 → 2)가 통과했다.
// ★고친 계층만 재면, 그 위 계층이 같은 결함을 다시 만들어도 초록이다.
describe('융합 검색까지 — 실제 진입점을 부른다 (코덱스 6b)', () => {
  const DETERMINISTIC: Embedder = {
    modelName: 'test', dimensions: DIMS,
    embed: async (t: string) => (t.includes('정답') ? [1, 0, 0, 0] : [0, 1, 0, 0]),
    embedBatch: async (ts: string[]) => ts.map(t => (t.includes('정답') ? [1, 0, 0, 0] : [0, 1, 0, 0])),
  };

  it('★ 회귀: 넘치는 문서가 있어도 정답이 <최종 결과>에 들어온다', async () => {
    await doc('flood', 'flood.md');
    await store.upsertChunks(Array.from({ length: 40 }, (_, i) => ({
      id: `flood#${String(i).padStart(2, '0')}`, documentId: 'flood',
      content: 'gateway telemetry payload', heading: '', startLine: 0, endLine: 1,
      tokenCount: 3, embedding: [0, 1, 0, 0],
    })));
    await doc('answer', 'answer.md');
    await store.upsertChunks([{
      id: 'answer#0', documentId: 'answer', content: 'telemetry 정답 문단',
      heading: '', startLine: 0, endLine: 1, tokenCount: 3, embedding: [1, 0, 0, 0],
    }]);

    const engine = createSearchEngine({ store, embedder: DETERMINISTIC });
    const results = await engine.search({ query: 'telemetry', limit: 5 });

    expect(results.map(r => r.document.id)).toContain('answer');
  });
});

describe('상한이 <무엇을> 남기는지 — 표면이 아니라 선택 (코덱스 6b)', () => {
  it('★ 검색어가 없는 청크는 결과에 들어오지 않는다 (MATCH 필터가 실제로 건다)', async () => {
    await doc('d', 'd.md');
    await store.upsertChunks([
      { id: 'd#hit', documentId: 'd', content: 'telemetry 가 있는 문단',
        heading: '', startLine: 0, endLine: 1, tokenCount: 3, embedding: [0.1, 0.1, 0.1, 0.1] },
      { id: 'd#miss', documentId: 'd', content: '전혀 상관없는 문장',
        heading: '', startLine: 0, endLine: 1, tokenCount: 3, embedding: [0.1, 0.1, 0.1, 0.1] },
    ]);

    const r = await store.searchKeyword('telemetry', 30);
    expect(r.map(x => x.chunkId)).toEqual(['d#hit']);
  });

  it('★ 문서당 둘을 남길 때 <가장 가까운> 둘을 남긴다 (의미 검색)', async () => {
    await doc('d', 'd.md');
    // 질의 [1,0,0,0] 에서 near → far 순으로 4개.
    const vecs: number[][] = [[1, 0, 0, 0], [0.9, 0.1, 0, 0], [0.2, 0.9, 0, 0], [0, 1, 0, 0]];
    await store.upsertChunks(vecs.map((v, i) => ({
      id: `d#${i}`, documentId: 'd', content: `문단 ${i}`,
      heading: '', startLine: 0, endLine: 1, tokenCount: 2, embedding: v,
    })));

    const r = await store.searchSemantic([1, 0, 0, 0], 30);
    expect(r.map(x => x.chunkId)).toEqual(['d#0', 'd#1']);   // 가장 먼 둘이면 d#3, d#2
  });

  it('★ 서로 다른 문서가 8개를 넘어도 전부 낼 수 있다 (숨은 하드캡이 없다)', async () => {
    for (let i = 0; i < 12; i++) {
      await doc(`doc${i}`, `doc${i}.md`);
      await store.upsertChunks([{
        id: `doc${i}#0`, documentId: `doc${i}`, content: 'telemetry 문단',
        heading: '', startLine: 0, endLine: 1, tokenCount: 2, embedding: [0.1, 0.1, 0.1, 0.1],
      }]);
    }

    const r = await store.searchKeyword('telemetry', 12);
    expect(r.length).toBe(12);
  });
});
