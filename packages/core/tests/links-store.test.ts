import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import type { VectorStore } from '../src/store/types.js';
import { collectDocumentLinks, toLinkRows } from '../src/links/wikilink.js';
import type { Document } from '../src/types/document.js';

let store: VectorStore;

function makeDoc(over: Partial<Document> & { id: string; filePath: string }): Document {
  return {
    title: over.filePath.replace(/\.md$/, ''),
    content: '',
    frontmatter: {},
    tags: [],
    lastModified: '2026-01-01T00:00:00.000Z',
    contentHash: over.id,
    ...over,
  };
}

/** 실제 인덱서와 같은 순서: upsertDocument → upsertLinks. */
async function addDoc(s: VectorStore, doc: Document): Promise<void> {
  await s.upsertDocument(doc);
  await s.upsertLinks(doc.id, toLinkRows(collectDocumentLinks(doc.content, doc.frontmatter)));
}

function db(s: VectorStore): BetterSqlite3.Database {
  return s.getDb() as BetterSqlite3.Database;
}

function countLinks(s: VectorStore, sourceDocId?: string): number {
  const row = sourceDocId
    ? db(s).prepare('SELECT COUNT(*) AS c FROM links WHERE source_doc_id = ?').get(sourceDocId)
    : db(s).prepare('SELECT COUNT(*) AS c FROM links').get();
  return (row as { c: number }).c;
}

beforeEach(async () => {
  store = createSqliteVecStore(':memory:', 4);
  await store.initialize();
});

afterEach(async () => {
  await store.close();
});

describe('links 저장', () => {
  it('upsertLinks 는 중복 누적이 아니라 교체다', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'src.md', content: '[[A]] [[B]] [[C]]' }));
    expect(countLinks(store, 'src')).toBe(3);

    await store.upsertLinks('src', toLinkRows(collectDocumentLinks('[[A]]')));
    expect(countLinks(store, 'src')).toBe(1);

    await store.upsertLinks('src', []);
    expect(countLinks(store, 'src')).toBe(0);
  });

  it('행에 raw/norm/section/alias/position 이 그대로 실린다', async () => {
    await addDoc(store, makeDoc({
      id: 'src', filePath: 'src.md',
      content: '[[ Foo Bar ]] then [[Note#Sec|보기]]',
    }));
    const rows = db(store)
      .prepare('SELECT target_raw, target_norm, section, alias, position FROM links WHERE source_doc_id = ? ORDER BY position')
      .all('src');
    expect(rows).toEqual([
      { target_raw: 'Foo Bar', target_norm: 'foo bar', section: null, alias: null, position: 0 },
      { target_raw: 'Note', target_norm: 'note', section: 'Sec', alias: '보기', position: 1 },
    ]);
  });

  it('frontmatter(YAML) 링크도 저장된다 — doc.content 에는 안 보이는 것들', async () => {
    await addDoc(store, makeDoc({
      id: 'src', filePath: 'src.md',
      content: 'body [[Body Note]]',
      frontmatter: { up: '[[Yaml Note]]', related: ['[[Yaml Two]]'] },
    }));
    const targets = db(store)
      .prepare('SELECT target_norm FROM links WHERE source_doc_id = ? ORDER BY position')
      .all('src')
      .map((r) => (r as { target_norm: string }).target_norm);
    expect(targets).toEqual(['yaml note', 'yaml two', 'body note']);
  });

  // 회귀 방지: 원래는 "호출부가 upsertDocument 뒤에 upsertLinks 를 부른다"는 규약이었고,
  // 그걸 안 지키는 경로가 4개 있었다(PUT /api/document/:id, ingest 2곳, pack/importer).
  // INSERT OR REPLACE 가 documents 행을 교체하는 순간 links FK 의 ON DELETE CASCADE 가
  // 링크를 전부 지우므로, 규약 위반은 조용한 데이터 손실이었다. 이제 upsertDocument 가
  // 스스로 파생·기록하므로 아래 두 테스트는 "호출부 협조 없이" 성립해야 한다.
  it('upsertDocument 단독으로 링크가 기록된다 — upsertLinks 를 부르는 호출부가 없어도', async () => {
    await store.upsertDocument(makeDoc({ id: 'src', filePath: 'src.md', content: '[[A]] [[B]]' }));
    expect(countLinks(store, 'src')).toBe(2);
  });

  it('문서를 다시 upsert 해도 링크가 증발하지 않는다 (cascade 후 같은 트랜잭션에서 재기록)', async () => {
    await store.upsertDocument(makeDoc({ id: 'src', filePath: 'src.md', content: '[[A]]' }));
    expect(countLinks(store, 'src')).toBe(1);

    // 예전 버그 재현 경로: 문서만 갈아끼우고 링크는 아무도 다시 안 쓴다.
    await store.upsertDocument(makeDoc({ id: 'src', filePath: 'src.md', content: '[[A]] [[B]] [[C]]' }));
    expect(countLinks(store, 'src')).toBe(3);

    // 링크가 사라진 본문으로 교체하면 행도 따라 줄어야 한다(스테일 잔존 금지).
    await store.upsertDocument(makeDoc({ id: 'src', filePath: 'src.md', content: '링크 없음' }));
    expect(countLinks(store, 'src')).toBe(0);
  });

  it('문서를 지우면 그 문서의 링크 행도 사라진다', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'src.md', content: '[[A]] [[B]]' }));
    await store.deleteByDocumentId('src');
    expect(countLinks(store, 'src')).toBe(0);
  });

  it('링크 *타깃* 을 지워도 소스의 링크 행은 남는다 (백링크가 조용히 증발하면 안 된다)', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'src.md', content: '[[Target]]' }));
    await addDoc(store, makeDoc({ id: 'tgt', filePath: 'Target.md' }));
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'tgt' }]);

    await store.deleteByDocumentId('tgt');
    // 본문엔 여전히 [[Target]] 이 적혀 있다 → 행은 남고, 해석만 실패(broken)한다.
    expect(countLinks(store, 'src')).toBe(1);
    expect(await store.getLinkPairs()).toEqual([]);

    // 타깃이 돌아오면 재인덱싱 없이 다시 해석된다 (해석은 질의 시점에 일어나므로)
    await addDoc(store, makeDoc({ id: 'tgt2', filePath: 'Target.md' }));
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'tgt2' }]);
  });
});

describe('해석 사다리', () => {
  it('(a) vault 상대경로 + .md 정확일치가 basename 보다 먼저', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'A/src.md', content: '[[B/Note]]' }));
    await addDoc(store, makeDoc({ id: 'a', filePath: 'A/Note.md' }));
    await addDoc(store, makeDoc({ id: 'b', filePath: 'B/Note.md' }));
    // basename 으로 떨어졌다면 동점 처리(같은 폴더 우선)가 'a' 를 골랐을 것이다.
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'b' }]);
  });

  it('(a) 타깃이 이미 .md 로 끝나도 된다', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'src.md', content: '[[B/Note.md]]' }));
    await addDoc(store, makeDoc({ id: 'b', filePath: 'B/Note.md' }));
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'b' }]);
  });

  it('(b) basename, 대소문자 구분 — 실측 87.8%', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'src.md', content: '[[Uniquely Named]]' }));
    await addDoc(store, makeDoc({ id: 'u', filePath: 'deep/folder/Uniquely Named.md' }));
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'u' }]);
  });

  it('(c) frontmatter title — basename/경로가 모두 빗나갈 때 (+8.1%p)', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'src.md', content: '[[Shared Label]]' }));
    await addDoc(store, makeDoc({
      id: 'fm', filePath: 'raw/20260101-slug.md',
      title: 'raw/20260101-slug', frontmatter: { title: 'Shared Label' },
    }));
    // title 컬럼(=H1 사다리)만 맞는 문서는 뒤 순위여야 한다.
    await addDoc(store, makeDoc({ id: 'h1', filePath: 'other/h1.md', title: 'Shared Label' }));
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'fm' }]);
  });

  it('(d) H1 — scanner 가 frontmatter title 없을 때 title 컬럼에 채워둔 값', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'src.md', content: '[[첫 헤딩]]' }));
    await addDoc(store, makeDoc({ id: 'h', filePath: 'notes/2026-01-01.md', title: '첫 헤딩' }));
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'h' }]);
  });

  it('(e) 대소문자 무시 재시도는 마지막 수단이다', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'src.md', content: '[[camelcase note]]' }));
    await addDoc(store, makeDoc({ id: 'c', filePath: 'deep/CamelCase Note.md' }));
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'c' }]);
  });

  it('해석 실패(broken, 실측 11.55%)는 쌍을 만들지 않는다', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'src.md', content: '[[Nowhere To Be Found]]' }));
    expect(await store.getLinkPairs()).toEqual([]);
  });

  it('자기 참조와 중복 링크는 엣지가 되지 않는다', async () => {
    await addDoc(store, makeDoc({
      id: 'src', filePath: 'src.md',
      content: '[[src]] [[Target]] [[target]] [[Target#Sec]]',
    }));
    await addDoc(store, makeDoc({ id: 'tgt', filePath: 'Target.md' }));
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'tgt' }]);
  });
});

describe('동점 처리 (실측: 946개 파일이 378개 basename 중복 그룹)', () => {
  it('1순위 — 소스와 같은 폴더', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'raw/source.md', content: '[[Dup Slug]]' }));
    await addDoc(store, makeDoc({ id: 'wiki', filePath: '_wiki/dup-slug.md', frontmatter: { title: 'Dup Slug' } }));
    await addDoc(store, makeDoc({ id: 'raw', filePath: 'raw/20260101-dup-slug.md', frontmatter: { title: 'Dup Slug' } }));
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'raw' }]);
  });

  it('2순위 — 짧은 경로', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'other/src.md', content: '[[Dup]]' }));
    await addDoc(store, makeDoc({ id: 'short', filePath: 'x/Dup.md' }));
    await addDoc(store, makeDoc({ id: 'long', filePath: 'longer/path/Dup.md' }));
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'short' }]);
  });

  it('3순위 — 길이까지 같으면 _wiki 아래가 아닌 쪽', async () => {
    await addDoc(store, makeDoc({ id: 'src', filePath: 'src/s.md', content: '[[aa]]' }));
    await addDoc(store, makeDoc({ id: 'wiki', filePath: '_wiki/aa.md' }));
    await addDoc(store, makeDoc({ id: 'raw', filePath: 'zzraw/aa.md' }));
    expect(await store.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'raw' }]);
  });

  it('삽입 순서가 달라도 같은 승자 — 결정적이다', async () => {
    const other = createSqliteVecStore(':memory:', 4);
    await other.initialize();
    try {
      await addDoc(other, makeDoc({ id: 'raw', filePath: 'zzraw/aa.md' }));
      await addDoc(other, makeDoc({ id: 'wiki', filePath: '_wiki/aa.md' }));
      await addDoc(other, makeDoc({ id: 'src', filePath: 'src/s.md', content: '[[aa]]' }));
      expect(await other.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'raw' }]);
      expect(await other.getLinkPairs()).toEqual(await other.getLinkPairs());
    } finally {
      await other.close();
    }
  });
});

// 🔴 백필은 <스토어를 여는 것>이 아니라 <소유가 확인된 색인기>가 부른다 (코덱스 12차 P1).
//    initialize() 안에 있던 시절에는, 남의 DB 를 열어보기만 해도 그 DB 에 썼다.
//    ⚠️ 대가를 적어 둔다: 옛 DB 의 1회성 이관이 <다음 열기>가 아니라 <다음 색인>에 일어난다.
describe('재인덱싱 없는 백필', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sv-links-'));
    dbPath = join(dir, 'index.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** links 를 몰랐던 시절의 DB 재현: 본문은 있는데 links 행도 마커도 없다. */
  async function seedLegacyDb(): Promise<void> {
    const legacy = createSqliteVecStore(dbPath, 4);
    await legacy.initialize();
    // upsertDocument 만 호출 — 예전 인덱서가 하던 그대로
    await legacy.upsertDocument(makeDoc({
      id: 'src', filePath: 'notes/src.md',
      content: 'body [[Target]] and a fence:\n\n```\n[[tts:text]]\n```\n',
      frontmatter: { up: '[[Target]]' },
    }));
    await legacy.upsertDocument(makeDoc({ id: 'tgt', filePath: 'notes/Target.md' }));
    db(legacy).prepare('DELETE FROM links').run();
    db(legacy).prepare('DELETE FROM stellavault_meta').run();
    await legacy.close();
  }

  it('색인기가 부를 때 한 번 채운다 — 볼트 파일 재스캔도 재임베딩도 없이', async () => {
    await seedLegacyDb();

    const reopened = createSqliteVecStore(dbPath, 4);
    await reopened.initialize();
    // ★여는 것만으로는 <아무 일도 없다> — 그 자체가 이 회차의 수정이다.
    expect(countLinks(reopened)).toBe(0);
    reopened.runMaintenanceOnce();
    try {
      // 본문 링크 1 + frontmatter 링크 1. 펜스 안 [[tts:text]] 는 마스킹된다.
      expect(countLinks(reopened)).toBe(2);
      expect(await reopened.getLinkPairs()).toEqual([{ sourceDocId: 'src', targetDocId: 'tgt' }]);
    } finally {
      await reopened.close();
    }
  });

  it('마커 덕분에 다음 실행에선 본문을 다시 읽지 않는다', async () => {
    await seedLegacyDb();
    const first = createSqliteVecStore(dbPath, 4);
    await first.initialize();
    first.runMaintenanceOnce();
    const marker = db(first)
      .prepare('SELECT value FROM stellavault_meta WHERE key = ?')
      .get('links_backfill_v1');
    expect(marker).toBeTruthy();
    // 마커가 있으면 백필은 완전히 건너뛴다 — 아래에서 지워둔 행이 다시 생기지 않는 것으로 확인
    db(first).prepare('DELETE FROM links').run();
    await first.close();

    const second = createSqliteVecStore(dbPath, 4);
    await second.initialize();
    second.runMaintenanceOnce();
    try {
      expect(countLinks(second)).toBe(0);
    } finally {
      await second.close();
    }
  });

  it('멱등 — 두 번 돌려도 행이 두 배가 되지 않는다', async () => {
    await seedLegacyDb();

    const first = createSqliteVecStore(dbPath, 4);
    await first.initialize();
    first.runMaintenanceOnce();
    const after1 = countLinks(first);
    // 🔴 0 === 0 으로 공허하게 통과하던 자리다 — 실제로 채워졌음을 먼저 못박는다.
    expect(after1).toBeGreaterThan(0);
    // 마커만 지우고 links 는 남긴 채로 다시 돌린다
    db(first).prepare('DELETE FROM stellavault_meta').run();
    await first.close();

    const second = createSqliteVecStore(dbPath, 4);
    await second.initialize();
    second.runMaintenanceOnce();
    try {
      expect(countLinks(second)).toBe(after1);
    } finally {
      await second.close();
    }
  });

  it('링크가 하나도 없는 볼트도 마커를 남긴다 (COUNT(*)=0 게이트였다면 매번 전 문서 재독)', async () => {
    const empty = createSqliteVecStore(dbPath, 4);
    await empty.initialize();
    empty.runMaintenanceOnce();
    try {
      expect(countLinks(empty)).toBe(0);
      const marker = db(empty)
        .prepare('SELECT value FROM stellavault_meta WHERE key = ?')
        .get('links_backfill_v1');
      expect(marker).toBeTruthy();
    } finally {
      await empty.close();
    }
  });
});
