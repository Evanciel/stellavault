// Fixtures are built from shapes that actually occur in the 17,642-note vault this
// parser was measured against: [[target]] (89.4%), [[target|alias]] (10.6%), CJK targets,
// YAML property links (32 of them), the `[[tts:text]]` placeholder inside fenced samples
// under 04_Projects/oasis-agent/docs/ (the bulk of the 50 code false positives), and the
// 16 unclosed `[[` openers sitting in frontmatter.

import { describe, it, expect } from 'vitest';
import {
  splitWikilinkInner,
  parseWikilinks,
  resolveTargetKey,
  replaceWikilinks,
  parseFrontmatterWikilinks,
  collectDocumentLinks,
  toLinkRows,
  frontmatterEnd,
} from '../src/links/wikilink.js';

describe('splitWikilinkInner', () => {
  it('알리아스 없음', () => {
    expect(splitWikilinkInner('Foo Bar')).toEqual({ target: 'Foo Bar', alias: null });
  });

  it('첫 파이프에서만 자른다', () => {
    expect(splitWikilinkInner('Foo|bar|baz')).toEqual({ target: 'Foo', alias: 'bar|baz' });
  });

  it('VERBATIM — 공백을 트림하지 않는다 (에디터 바이트 라운드트립)', () => {
    expect(splitWikilinkInner(' Foo ')).toEqual({ target: ' Foo ', alias: null });
    expect(splitWikilinkInner(' Foo | bar ')).toEqual({ target: ' Foo ', alias: ' bar ' });
  });

  it('빈 타깃도 그대로', () => {
    expect(splitWikilinkInner('|alias')).toEqual({ target: '', alias: 'alias' });
  });
});

describe('parseWikilinks — 기본 형태', () => {
  it('평문 링크', () => {
    const links = parseWikilinks('see [[Zettelkasten]] please');
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('Zettelkasten');
    expect(links[0].alias).toBeNull();
    expect(links[0].section).toBeNull();
    expect(links[0].isEmbed).toBe(false);
    expect(links[0].inFrontmatter).toBe(false);
    // 오프셋은 원문 기준
    expect('see [[Zettelkasten]] please'.slice(links[0].index, links[0].index + links[0].length))
      .toBe('[[Zettelkasten]]');
  });

  it('알리아스 링크', () => {
    const [link] = parseWikilinks('[[stellavault-strategy-positioning|포지셔닝]]');
    expect(link.target).toBe('stellavault-strategy-positioning');
    expect(link.alias).toBe('포지셔닝');
  });

  it('임베드 — index/length 가 선행 ! 를 포함', () => {
    const text = 'x ![[Diagram]] y';
    const [link] = parseWikilinks(text);
    expect(link.isEmbed).toBe(true);
    expect(link.target).toBe('Diagram');
    expect(text.slice(link.index, link.index + link.length)).toBe('![[Diagram]]');
  });

  it('헤딩 앵커와 블록 앵커 — 파싱만 한다(해석 로직 없음)', () => {
    const [heading] = parseWikilinks('[[Note#Section Two]]');
    expect(heading.target).toBe('Note');
    expect(heading.section).toBe('Section Two');
    expect(heading.isBlockRef).toBe(false);

    const [block] = parseWikilinks('[[Note#^abc123]]');
    expect(block.section).toBe('^abc123');
    expect(block.isBlockRef).toBe(true);
  });

  it('앵커 + 알리아스 동시', () => {
    const [link] = parseWikilinks('[[Note#Sec|보기 이름]]');
    expect(link.target).toBe('Note');
    expect(link.section).toBe('Sec');
    expect(link.alias).toBe('보기 이름');
  });

  it('CJK 타깃', () => {
    const links = parseWikilinks('[[운명 프리즘]] 과 [[자비스 에이전트|자비스]]');
    expect(links.map((l) => l.target)).toEqual(['운명 프리즘', '자비스 에이전트']);
    expect(links[1].alias).toBe('자비스');
  });

  it('슬래시가 들어간 타깃 (606개 중 1개)', () => {
    const [link] = parseWikilinks('[[04_Projects/oasis-agent/README]]');
    expect(link.target).toBe('04_Projects/oasis-agent/README');
  });

  it('빈 텍스트 / 링크 없음', () => {
    expect(parseWikilinks('')).toEqual([]);
    expect(parseWikilinks('그냥 문장 [단일 브래킷] 뿐')).toEqual([]);
  });
});

describe('parseWikilinks — 줄 경계 (line-bounded regex)', () => {
  it('닫히지 않은 여는 괄호는 다음 줄의 닫는 괄호와 짝지어지지 않는다', () => {
    // 예전 /\[\[([^\]]+)\]\]/g 는 [^\]] 가 개행을 삼켜서 이걸 하나의 거대한 타깃으로 잡았다.
    const text = 'related: [[Unclosed\nbody line\nlater [[Real Note]] here';
    const links = parseWikilinks(text);
    expect(links.map((l) => l.target)).toEqual(['Real Note']);
  });

  it('링크는 줄을 넘지 않는다', () => {
    expect(parseWikilinks('[[Multi\nLine]]')).toEqual([]);
  });

  it('중첩 브래킷: 안쪽 것만 잡는다', () => {
    const links = parseWikilinks('[[[Foo]]]');
    expect(links.map((l) => l.target)).toEqual(['Foo']);
  });
});

describe('parseWikilinks — 코드 마스킹', () => {
  it('펜스 블록 안의 자리표시자 문법을 버린다 (실측 오탐 1.91% 의 대부분)', () => {
    const text = [
      'intro [[Real Note]]',
      '',
      '```json',
      '{ "cmd": "[[tts:text]]" }',
      '{ "reply": "[[reply_to:<id>]]" }',
      '```',
      '',
      'outro [[Second Note]]',
    ].join('\n');
    expect(parseWikilinks(text).map((l) => l.target)).toEqual(['Real Note', 'Second Note']);
  });

  it('~~~ 펜스도 동일하게, 그리고 닫는 펜스는 같은 문자 + 같은 길이 이상', () => {
    const text = '~~~~\n[[Hidden]]\n~~~\nstill hidden [[Also Hidden]]\n~~~~\n[[Visible]]';
    expect(parseWikilinks(text).map((l) => l.target)).toEqual(['Visible']);
  });

  it('인라인 백틱', () => {
    const text = 'use `[[tts:text]]` but link [[Real]] and ``a [[X]] b`` here';
    expect(parseWikilinks(text).map((l) => l.target)).toEqual(['Real']);
  });

  it('짝 없는 백틱은 나머지 줄을 삼키지 않는다', () => {
    expect(parseWikilinks('stray ` tick then [[Real]]').map((l) => l.target)).toEqual(['Real']);
  });

  it('4칸 들여쓰기 블록', () => {
    const text = 'para\n\n    code [[Hidden]]\n    more [[AlsoHidden]]\n\nafter [[Real]]';
    expect(parseWikilinks(text).map((l) => l.target)).toEqual(['Real']);
  });

  it('들여쓴 리스트 연속 줄은 코드가 아니다 (문단을 끊을 수 없다는 규칙)', () => {
    const text = '- item one\n    continued [[Real]]';
    expect(parseWikilinks(text).map((l) => l.target)).toEqual(['Real']);
  });

  it('skipCode:false 면 전부 살린다', () => {
    const text = '```\n[[tts:text]]\n```\n[[Real]]';
    expect(parseWikilinks(text, { skipCode: false }).map((l) => l.target))
      .toEqual(['tts:text', 'Real']);
  });

  it('마스킹해도 index 는 원문 오프셋을 가리킨다', () => {
    const text = '```\n[[hidden]]\n```\ntail [[Real]]';
    const [link] = parseWikilinks(text);
    expect(text.slice(link.index, link.index + link.length)).toBe('[[Real]]');
  });
});

describe('frontmatter', () => {
  const doc = [
    '---',
    'title: 실전 노트',
    'related:',
    '  - "[[Zettelkasten]]"',
    'up: "[[Index|상위]]"',
    '---',
    '',
    'body links to [[Other Note]]',
  ].join('\n');

  it('frontmatterEnd 는 닫는 --- 다음을 가리킨다', () => {
    expect(doc.slice(0, frontmatterEnd(doc)).endsWith('---\n')).toBe(true);
  });

  it('닫히지 않은 --- 는 frontmatter 로 치지 않는다', () => {
    expect(frontmatterEnd('---\ntitle: x\nbody\n')).toBe(0);
  });

  it('frontmatter 는 코드가 아니다 — 링크를 버리지 않고 플래그만 세운다', () => {
    const links = parseWikilinks(doc);
    expect(links.map((l) => l.target)).toEqual(['Zettelkasten', 'Index', 'Other Note']);
    expect(links.map((l) => l.inFrontmatter)).toEqual([true, true, false]);
  });

  it('4칸 들여쓴 YAML 값도 코드 블록으로 오인하지 않는다', () => {
    const yaml = '---\nrelated:\n    - "[[Deep Indent]]"\n---\n\nbody\n';
    expect(parseWikilinks(yaml).map((l) => l.target)).toEqual(['Deep Indent']);
  });
});

describe('resolveTargetKey', () => {
  it('트림 + 소문자 + 앵커 제거', () => {
    expect(resolveTargetKey('  Foo Bar  ')).toBe('foo bar');
    expect(resolveTargetKey('Note#Section')).toBe('note');
    expect(resolveTargetKey('Note#^blk')).toBe('note');
  });

  it('방어적으로 알리아스도 제거한다', () => {
    expect(resolveTargetKey('Note|alias')).toBe('note');
  });

  it('경로 구분자는 보존 (경로 정확일치 사다리가 쓴다)', () => {
    expect(resolveTargetKey('Folder/Note')).toBe('folder/note');
  });
});

describe('opts: dedupe / limit', () => {
  const text = '[[Foo]] [[foo]] [[ Foo ]] [[Bar]]';

  it('기본은 dedupe 하지 않는다', () => {
    expect(parseWikilinks(text)).toHaveLength(4);
  });

  it('dedupe 는 정규화 키 기준, 첫 등장을 남긴다', () => {
    const links = parseWikilinks(text, { dedupe: true });
    expect(links.map((l) => l.target)).toEqual(['Foo', 'Bar']);
  });

  it('limit', () => {
    expect(parseWikilinks(text, { limit: 2 })).toHaveLength(2);
  });
});

describe('replaceWikilinks', () => {
  it('마크다운 링크로 치환', () => {
    const out = replaceWikilinks('a [[Foo|보기]] b [[Bar]] c', (l) => `[${l.alias ?? l.target}](${l.target}.md)`);
    expect(out).toBe('a [보기](Foo.md) b [Bar](Bar.md) c');
  });

  it('null 을 돌려주면 원문 유지', () => {
    const out = replaceWikilinks('[[Keep]] and [[Drop]]', (l) => (l.target === 'Drop' ? 'X' : null));
    expect(out).toBe('[[Keep]] and X');
  });

  it('코드 안은 건드리지 않는다', () => {
    const text = '`[[tts:text]]` and [[Real]]';
    expect(replaceWikilinks(text, () => 'X')).toBe('`[[tts:text]]` and X');
  });
});

describe('parseFrontmatterWikilinks / collectDocumentLinks / toLinkRows', () => {
  it('중첩 객체·배열의 문자열 값을 훑는다', () => {
    const fm = { up: '[[Parent]]', related: ['[[A]]', '[[B|별칭]]'], meta: { see: '[[C]]' }, n: 42 };
    const links = parseFrontmatterWikilinks(fm);
    expect(links.map((l) => l.target)).toEqual(['Parent', 'A', 'B', 'C']);
    expect(links.every((l) => l.inFrontmatter)).toBe(true);
  });

  it('collectDocumentLinks: frontmatter 먼저, 그 다음 본문', () => {
    // doc.content 는 gray-matter 이후의 본문이라 YAML 링크는 본문 스캔에 안 보인다.
    const links = collectDocumentLinks('body [[Body Note]]', { up: '[[Yaml Note]]' });
    expect(links.map((l) => l.target)).toEqual(['Yaml Note', 'Body Note']);
  });

  it('toLinkRows: 정규화 + 순번, 타깃 없는 링크는 버린다', () => {
    const rows = toLinkRows(collectDocumentLinks('[[ Foo ]] [[|alias]] [[#Heading]] [[Bar#Sec|보기]]'));
    expect(rows).toEqual([
      { targetRaw: 'Foo', targetNorm: 'foo', section: null, alias: null, position: 0 },
      { targetRaw: 'Bar', targetNorm: 'bar', section: 'Sec', alias: '보기', position: 1 },
    ]);
  });

  it('문서당 링크 상한이 있다 (테이블/엣지 폭주 방지)', () => {
    const many = Array.from({ length: 1500 }, (_, i) => `[[N${i}]]`).join(' ');
    expect(collectDocumentLinks(many).length).toBe(1000);
  });
});
