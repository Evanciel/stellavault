// 🔴 ingest 가 만드는 경로는 <파일 스캐너와 같은 유도>를 내야 한다.
//
// 배경: ingest 는 join(folder, filename) 을 documents 의 <id 에도 file_path 에도>
// 그대로 쓴다. 윈도우에서 join() 은 역슬래시를 내는데, 파일 스캐너는 같은 파일을
// 슬래시로 정규화해 해시한다. 그래서 같은 노트가 두 행으로 남았다 —
// UNIQUE(file_path) 도 두 문자열을 다른 값으로 보므로 INSERT OR REPLACE 가 못 치운다.
// 색인기가 그 중복을 치우지만, 근원을 안 고치면 ingest 마다 다시 생긴다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ingest, toVaultPath } from '../src/intelligence/ingest-pipeline.js';
import { docIdForPath } from '../src/indexer/scanner.js';

const BS = String.fromCharCode(92);
let vault: string;
beforeEach(() => { vault = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'ing-')); });
afterEach(() => { rmSync(vault, { recursive: true, force: true }); });

describe('ingest 경로 정규화', () => {
  it('★ 회귀: savedTo 에 역슬래시가 없다', () => {
    const r = ingest(vault, { type: 'note', content: '본문이 충분히 길게 있다. '.repeat(5), title: '테스트 노트' });
    expect(r.savedTo).not.toContain(BS);
    expect(r.savedTo).toContain('/');            // 폴더 하위에 저장된다 = 구분자가 있다
  });

  it('★ 회귀: savedTo 로 만든 id 가 <파일 스캐너의 id 와 같다>', () => {
    // 이 둘이 다르면 같은 노트가 두 행이 된다. 그게 이 세션이 쫓던 중복의 근원이다.
    const r = ingest(vault, { type: 'note', content: '본문이 충분히 길게 있다. '.repeat(5), title: '테스트 노트' });
    const ingestId = createHash('sha256').update(r.savedTo).digest('hex').slice(0, 16);
    expect(ingestId).toBe(docIdForPath(vault, join(vault, r.savedTo)));
  });

  it('스캐너가 그 파일을 <같은 경로로> 되읽는다', () => {
    const r = ingest(vault, { type: 'note', content: '본문이 충분히 길게 있다. '.repeat(5), title: '테스트 노트' });
    // 실제로 그 자리에 파일이 있다 (경로가 맞다는 뜻)
    expect(() => writeFileSync(join(vault, r.savedTo), '# t\n\n확인', { flag: 'r+' })).not.toThrow();
  });
});

// 🔴 코덱스 7차 P1 — ingest 는 문서 행만 쓰고 청크를 못 굽는다(라우터에 임베더가 없다).
//
// 이것은 <유실>이 아니라 <일시적 불일치>다. 다만 그 주장을 말로 두지 않고 잰다:
// 다음 색인이 ① 같은 id 로 ② 중복 없이 ③ 검색 가능하게 만드는가.
// ★이 셋이 성립하는 이유가 바로 위 정규화다 — id 가 어긋나면 두 행이 되고 자가치유가 깨진다.
describe('ingest 직후 상태와 자가치유', () => {
  it('★ 회귀: ingest 가 만든 행을 다음 색인이 <같은 id 로> 검색 가능하게 만든다', async () => {
    const { createSqliteVecStore } = await import('../src/store/sqlite-vec.js');
    const { indexVault } = await import('../src/indexer/index.js');
    const store = await (async () => {
      const s = createSqliteVecStore(':memory:', 4);
      await s.initialize();
      return s;
    })();
    const embedder = {
      modelName: 'test', dimensions: 4,
      embed: async () => [0.1, 0.2, 0.3, 0.4],
      embedBatch: async (t: string[]) => t.map(() => [0.1, 0.2, 0.3, 0.4]),
    };

    const r = ingest(vault, { type: 'note', content: '인제스트된본문이있다. '.repeat(5), title: '인제스트 노트' });
    // 라우터가 하는 것과 <같은> 유도로 문서 행만 쓴다 (청크 없음, contentHash 빈 문자열).
    const routeId = createHash('sha256').update(r.savedTo).digest('hex').slice(0, 16);
    await store.upsertDocument({
      id: routeId, filePath: r.savedTo, title: r.title, content: '인제스트된본문이있다.',
      frontmatter: {}, tags: r.tags, lastModified: new Date().toISOString(), contentHash: '',
    });
    expect(await store.searchKeyword('인제스트된본문이있다', 10)).toHaveLength(0);   // 아직 안 보인다

    const res = await indexVault(vault, { store, embedder });

    expect(res.indexed).toBeGreaterThanOrEqual(1);
    // ingest 는 자동 compile 로 다른 파일도 만든다 — <그 노트>만 본다.
    const docs = await store.getAllDocuments();
    const mine = docs.filter(d => d.filePath === r.savedTo);
    expect(mine.map(d => d.id)).toEqual([routeId]);                    // 중복 행이 생기지 않았다
    expect(mine[0].contentHash).not.toBe('');                          // 실제로 다시 구웠다
    expect((await store.searchKeyword('인제스트된본문이있다', 10)).length).toBeGreaterThan(0);
    await store.close();
  });
});

// 🔴 코덱스 8차 P2 — 위 시험들은 <리눅스 CI 에서 판별력이 0> 이다.
//
// `join()` 이 POSIX 에서 이미 슬래시를 내므로, 정규화를 통째로 지워도 리눅스에서는
// 전부 초록이다. 즉 CI 가 이 수정을 <한 번도 검증한 적이 없다>.
// → 정규화를 이름 있는 함수로 꺼내 <역슬래시를 직접 먹인다>. 이건 어느 플랫폼에서든 잰다.
describe('toVaultPath — 플랫폼과 무관하게 잰다', () => {
  const BS2 = String.fromCharCode(92);

  it('★ 회귀: 역슬래시가 섞여 들어와도 슬래시만 낸다', () => {
    expect(toVaultPath('00_Inbox' + BS2 + 'feeds', 'a.md')).toBe('00_Inbox/feeds/a.md');
    expect(toVaultPath('00_Inbox', 'sub' + BS2 + 'a.md')).toBe('00_Inbox/sub/a.md');
  });

  it('★ 결과에 역슬래시가 한 글자도 없다', () => {
    const out = toVaultPath('A' + BS2 + 'B' + BS2 + 'C', 'd' + BS2 + 'e.md');
    expect(out).not.toContain(BS2);
    expect(out).toBe('A/B/C/d/e.md');
  });

  it('평범한 입력은 그대로 이어붙인다', () => {
    expect(toVaultPath('00_Inbox', '2026-08-21T00-00-00-note.md'))
      .toBe('00_Inbox/2026-08-21T00-00-00-note.md');
  });
});
