// 🔴 깨진 프론트매터 때문에 <문서를 잃지> 않는다.
//
// 실측 2026-08-20: 볼트 17,371개 중 131개가 YAML 파싱에서 죽었다. 전부
// `title: Web — RAG Metrics: Assessing …` 처럼 따옴표 없는 값에 콜론이 든
// 자동생성 캡처 노트였고, <본문은 멀쩡했다>. 그 131개는 scanVault 의 skipped 로
// 빠졌고 indexVault 가 그것을 "지워진 파일" 로 오인해 색인에서 축출했다.
//
// 프론트매터는 부가정보고 본문이 자산이다. 못 읽으면 버리고 본문을 살린다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanVault, scanFile, stripFrontmatterBlock } from '../src/indexer/scanner.js';

let vault: string;
beforeEach(() => { vault = mkdtempSync(join(process.env.CLAUDE_TEST_TMP || tmpdir(), 'fm-')); });
afterEach(() => { rmSync(vault, { recursive: true, force: true }); });

const write = (rel: string, body: string) => {
  const p = join(vault, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
  return p;
};

// 실제로 볼트를 무너뜨린 모양 그대로.
const BROKEN = `---
title: Web — RAG Evaluation Metrics: Assessing Answer Relevancy, Faithfulness ...
date: 2026-06-01
---

# 본문 제목

본문은 멀쩡하다. 검색으로 찾을 수 있어야 한다.
`;

describe('깨진 프론트매터', () => {
  it('★ 회귀: 따옴표 없는 값에 콜론이 있어도 문서를 살린다', () => {
    write('broken.md', BROKEN);
    const r = scanVault(vault);

    expect(r.skipped.filter(s => s.reason === 'parse-error')).toHaveLength(0);
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0].content).toContain('본문은 멀쩡하다');
    expect(r.documents[0].content).not.toContain('date: 2026-06-01');   // 블록은 떼어냈다
  });

  it('★ 깨진 것을 <조용히> 넘기지 않는다 — 흔적을 남긴다', () => {
    const p = write('broken2.md', BROKEN);
    const r = scanFile(vault, p);
    expect('document' in r).toBe(true);
    if (!('document' in r)) return;
    expect(r.document.frontmatter.__frontmatterError).toBeTruthy();
  });

  it('★ 회귀: <같은 바이트를 두 번> 파싱해도 결과가 같다 (gray-matter 캐시)', () => {
    // gray-matter 는 options 가 없으면 원문 문자열로 캐시한다. 1차에 던진 원문이
    // 2차엔 `{data:{}, content:원문전체}` 로 와서, 예외만 보는 가드를 <통과>한다.
    // 그러면 프론트매터 글자가 본문에 섞이고 __frontmatterError 도 사라진다.
    // ★그 오염을 실제 볼트 색인에서 봤다 (2026-08-21, 131개). 합성 상황이 아니다.
    const a = write('twice-a.md', BROKEN);
    const b = write('twice-b.md', BROKEN);          // 바이트가 완전히 같다
    const ra = scanFile(vault, a);
    const rb = scanFile(vault, b);
    expect('document' in ra && 'document' in rb).toBe(true);
    if (!('document' in ra) || !('document' in rb)) return;

    for (const d of [ra.document, rb.document]) {
      expect(d.frontmatter.__frontmatterError).toBeTruthy();
      expect(d.content.startsWith('---')).toBe(false);
      expect(d.content).not.toContain('date: 2026-06-01');
      expect(d.content).toContain('본문은 멀쩡하다');
    }
  });

  it('★ 회귀: 닫는 --- 이 없어 본문이 <삼켜지는> 경우 (gotContent 분기)', () => {
    // '---\ntitle: x\n' 는 유효한 객체로 파싱된다(dataOk 통과). 그런데 content 가 ''
    // 이라 본문이 사라진다 — dataOk 만 보는 변이는 이 시험이 있어야 걸린다.
    const p = write('swallow.md', '---\ntitle: x\n');
    const r = scanFile(vault, p);
    // 🔴 "둘 중 아무거나" 로 두면 가드를 지워도 시험이 통과한다 (코덱스 2차 P2).
    //    실측한 동작 하나로 못박는다: 문서를 <살리고> 흔적을 남긴다.
    expect('document' in r).toBe(true);
    if (!('document' in r)) return;
    expect(r.document.content).toContain('title: x');
    expect(r.document.frontmatter.__frontmatterError).toBeTruthy();
  });

  it('★ 회귀: 멀쩡한 프론트매터 뒤 본문이 --- 로 시작해도 메타데이터를 안 버린다', () => {
    // notStripped 가드가 이 경우를 캐시 실패로 오판해 title·tags 를 통째로 버렸다
    // (코덱스 2차 P2, 2026-08-21 실측). 캐시 우회는 언제나 data 가 빈 객체다.
    write('hr.md', '---\ntitle: 정상 노트\ntags: [alpha]\n---\n---\n본문이 있다.\n');
    const d = scanVault(vault).documents[0];
    expect(d.frontmatter.__frontmatterError).toBeUndefined();
    expect(d.title).toBe('정상 노트');
    expect(d.tags).toEqual(expect.arrayContaining(['alpha']));
    expect(d.content).toContain('본문이 있다');
  });

  it('★ 회귀: 유효한 YAML 이라도 <파생>이 문서를 죽이지 않는다 (date: not-a-date)', () => {
    // 유효한 YAML 이라 파싱 try 를 통과한다. 그 뒤 new Date(...).toISOString() 이
    // RangeError 를 던져 파일 전체가 탈락했다 (코덱스 P1, 2026-08-21).
    write('baddate.md', '---\ntitle: 정상\ndate: not-a-date\n---\n\n본문이 있다.\n');
    const r = scanVault(vault);
    expect(r.skipped).toHaveLength(0);
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0].content).toContain('본문이 있다');
    // 🔴 "파싱 가능하다" 만 재면 아무 고정값이나 넣어도 통과한다 (코덱스 6b P2).
    //    못 읽은 날짜의 대체값은 <파일의 실제 mtime> 이어야 한다.
    const mtime = statSync(join(vault, 'baddate.md')).mtime.toISOString();
    expect(r.documents[0].lastModified).toBe(mtime);
  });

  it('★ 회귀: date 가 <boolean> 이면 mtime 으로 되돌린다 (1970 이 아니라)', () => {
    // YAML `date: false` 는 유효한 boolean 이고 `new Date(false)` 는 NaN 이 아니라
    // 1970-01-01 이다 — NaN 가드를 <통과해서> 1970년이 저장됐다 (코덱스 10차 P2).
    write('boolfalse.md', '---\ntitle: 정상\ndate: false\n---\n\n본문이 있다.\n');
    const d = scanVault(vault).documents[0];
    expect(d.lastModified).toBe(statSync(join(vault, 'boolfalse.md')).mtime.toISOString());
    expect(d.lastModified.startsWith('1970')).toBe(false);
  });

  it('★ date 가 <YAML Date 객체>면 그대로 쓴다 — 가드가 정상 경로를 막지 않는다', () => {
    write('realdate.md', '---\ntitle: 정상\ndate: 2026-06-01\n---\n\n본문.\n');
    const d = scanVault(vault).documents[0];
    expect(d.lastModified.startsWith('2026-06-01')).toBe(true);
  });

  it('★ 프론트매터가 <없어도> lastModified 는 파일 mtime 이다', () => {
    write('nofm2.md', '# 제목\n\n본문.\n');
    const d = scanVault(vault).documents[0];
    expect(d.lastModified).toBe(statSync(join(vault, 'nofm2.md')).mtime.toISOString());
  });

  it('★ 하위 폴더의 문서는 <경로를 잃지 않는다>', () => {
    // 픽스처가 전부 볼트 루트면 filePath 를 basename 으로 깎는 변이가 통과한다.
    write('20_Areas/deep/broken3.md', BROKEN);
    const d = scanVault(vault).documents[0];
    expect(d.filePath).toBe('20_Areas/deep/broken3.md');
  });

  it('제목은 본문 첫 헤딩으로 되돌아간다', () => {
    write('broken.md', BROKEN);
    expect(scanVault(vault).documents[0].title).toBe('본문 제목');
  });

  it('멀쩡한 프론트매터는 그대로 읽는다 (회귀 아님)', () => {
    write('okay.md', '---\ntitle: "정상 노트"\ntags: [a, b]\n---\n\n본문.\n');
    const d = scanVault(vault).documents[0];
    expect(d.title).toBe('정상 노트');
    expect(d.frontmatter.__frontmatterError).toBeUndefined();
    expect(d.tags).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('닫는 --- 이 없으면 프론트매터가 아니다 — 본문을 안 깎는다', () => {
    write('nofm.md', '---\n이건 그냥 구분선이다\n\n본문 시작.\n');
    const d = scanVault(vault).documents[0];
    expect(d.content).toContain('본문 시작');
    expect(d.content).toContain('이건 그냥 구분선이다');
  });
});

// stripFrontmatterBlock 을 <직접> 겨눈다.
// 폴백 경로에서만 불리므로 scanVault 를 통해서는 이 함수의 가드가 안 재진다 —
// 실제로 변이 F4(프론트매터 없는 파일도 깎음)가 그 구멍으로 살아남았다.
describe('stripFrontmatterBlock', () => {
  it('★ 회귀: 프론트매터로 시작하지 않으면 한 글자도 안 깎는다', () => {
    const body = '# 제목\n\n본문 첫 문단.\n\n---\n\n본문 둘째 문단.\n';
    expect(stripFrontmatterBlock(body)).toBe(body);
  });

  it('여는 --- 이 있고 닫는 --- 이 있으면 그 뒤만 남긴다', () => {
    expect(stripFrontmatterBlock('---\ntitle: x\n---\n\n본문.\n')).toBe('\n본문.\n');
  });

  it('닫는 --- 이 없으면 프론트매터가 아니다 — 원문 그대로', () => {
    const raw = '---\n그냥 구분선\n\n본문 시작.\n';
    expect(stripFrontmatterBlock(raw)).toBe(raw);
  });

  it('★ CRLF 를 LF 로 바꾸지 않는다 (정확 일치)', () => {
    // toContain 으로는 `return raw` 변이도 통과한다 — 정확 일치로 못박는다.
    expect(stripFrontmatterBlock('---\r\ntitle: x\r\n---\r\n\r\n본문.\r\n')).toBe('\r\n본문.\r\n');
  });

  it('★ 들여쓴 --- 는 닫는 구분자가 아니다 (YAML 블록 스칼라)', () => {
    const raw = '---\nnote: |\n  ---\n  안쪽 줄\ntitle: x\n---\n\n본문.\n';
    expect(stripFrontmatterBlock(raw)).toBe('\n본문.\n');
  });
});
