import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidModelRef } from '../src/main/ollama-manager.js';

// 이 문자열은 <레지스트리 URL 경로>와 <pull 요청 본문> 두 군데로 들어간다. 렌더러가 주는
// 유일한 입력이라, 여기가 이 기능의 신뢰 경계다.
describe('모델 참조 문법', () => {
  it('평범한 이름을 받는다', () => {
    for (const ok of ['gemma4', 'qwen3', 'llama3.3', 'deepseek-r1', 'mistral-small']) {
      expect(isValidModelRef(ok)).toBe(true);
    }
  });

  it('태그와 네임스페이스를 받는다', () => {
    expect(isValidModelRef('gemma4:12b')).toBe(true);
    expect(isValidModelRef('hf.co/bartowski')).toBe(true);
    expect(isValidModelRef('library/gemma4:e4b')).toBe(true);
  });

  // ★ 경로 조각으로 쓰이므로 상위 디렉터리로 기어 올라갈 수 있으면 안 된다.
  it('경로 탈출을 막는다', () => {
    for (const bad of ['../etc/passwd', '..', '.', 'a/../../b', 'gemma4/../../x']) {
      expect(isValidModelRef(bad)).toBe(false);
    }
  });

  it('URL 을 통째로 넣는 것을 막는다', () => {
    for (const bad of ['https://evil.test/x', 'http://127.0.0.1:11434/api/delete', '//evil.test']) {
      expect(isValidModelRef(bad)).toBe(false);
    }
  });

  it('경로·쿼리 구분자를 막는다', () => {
    for (const bad of ['a?b', 'a#b', 'a b', 'a\b', 'a%2e%2e', 'a\nb']) {
      expect(isValidModelRef(bad)).toBe(false);
    }
  });

  it('조각이 셋 이상이거나 콜론이 둘이면 거절한다', () => {
    expect(isValidModelRef('a/b/c')).toBe(false);
    expect(isValidModelRef('a:b:c')).toBe(false);
  });

  // Ollama 는 허깅페이스 GGUF 를 hf.co/<유저>/<레포> 로 직접 받는다(실측 확인). 그래서
  // 그 형태만 조각 셋을 허용한다 — 조각 수를 그냥 늘리면 임의 깊이 경로가 URL 로 들어간다.
  it('hf.co 일 때만 조각 셋을 허용한다', () => {
    expect(isValidModelRef('hf.co/unsloth/SmolLM2-135M-Instruct-GGUF')).toBe(true);
    expect(isValidModelRef('huggingface.co/bartowski/HuggingFaceTB_SmolLM3-3B-GGUF')).toBe(true);
    expect(isValidModelRef('hf.co/unsloth/SmolLM2-135M-Instruct-GGUF:Q4_K_M')).toBe(true);
    // 다른 호스트 이름표를 붙였다고 한 칸 더 주지 않는다
    expect(isValidModelRef('evil.test/a/b')).toBe(false);
    expect(isValidModelRef('hf.co/a/b/c')).toBe(false);
  });

  it('빈 문자열과 지나치게 긴 이름을 거절한다', () => {
    expect(isValidModelRef('')).toBe(false);
    expect(isValidModelRef('a'.repeat(161))).toBe(false);
    expect(isValidModelRef('a'.repeat(160))).toBe(true);
  });

  // 조각이 영숫자로 시작해야 한다 — 선행 하이픈은 CLI 플래그처럼 보이는 이름을 막는다.
  it('조각은 영숫자로 시작해야 한다', () => {
    expect(isValidModelRef('-rf')).toBe(false);
    expect(isValidModelRef('.hidden')).toBe(false);
    expect(isValidModelRef('gemma4:-x')).toBe(false);
  });
});

// ─── 배선 ───
// 검증이 아무리 좋아도 채널이 allowlist 밖이면 기능이 죽고, 안쪽이면 그 검증이 <실제로>
// 렌더러 입력을 받는 자리가 된다. 둘 다 소스에서 직접 확인한다.
describe('모델 설치 배선', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf-8');
  const preload = read('preload', 'index.ts');
  const main = read('main', 'index.ts');

  it('세 채널과 진행률 이벤트가 preload allowlist 에 있다', () => {
    for (const ch of ['ollama:model-exists', 'ollama:pull-model', 'ollama:pull-abort']) {
      expect(preload).toContain(`'${ch}'`);
    }
    expect(preload).toContain("'ollama:pull-progress'");
  });

  it('main 에 세 핸들러가 있다', () => {
    for (const ch of ['ollama:model-exists', 'ollama:pull-model', 'ollama:pull-abort']) {
      expect(main).toContain(`ipcMain.handle('${ch}'`);
    }
  });

  // ★ 진행률은 <요청한 렌더러에게만> 간다. 브로드캐스트하면 다른 창이 남의 설치 진행을 본다.
  it('카탈로그 조회도 allowlist 와 핸들러 양쪽에 있다', () => {
    expect(preload).toContain("'ollama:browse-models'");
    expect(main).toContain("ipcMain.handle('ollama:browse-models'");
  });

  // ★ 원격 HTML 에서 뽑은 이름도 pull 전에 같은 문법 검사를 통과해야 한다. 페이지 내용은
  //   데이터지 지시가 아니다 — 이 두 줄이 그 경계다.
  it('카탈로그에서 뽑은 이름도 모델 문법을 통과해야 한다', () => {
    const mgr = read('main', 'ollama-manager.ts');
    expect(mgr).toContain('if (isValidModelRef(name)) seen.add(name)');
  });

  // ★ electron 의 net.fetch 는 response.url 을 빈 문자열로 준다. 그 값만 믿고 호스트를
  //   판정했더니 <모든> 레지스트리 조회가 "확인 못 함" 으로 떨어졌다(라이브에서 카탈로그
  //   0개로 관측). 진짜 방어는 redirect:error 쪽이고, url 검사는 값이 있을 때만이다.
  it('빈 response.url 로 정상 응답을 버리지 않는다', () => {
    const mgr = read('main', 'ollama-manager.ts');
    expect(mgr).toContain("redirect: 'error'");
    expect(mgr).toContain('if (!res.url) return true;');
  });

  // 목록이 0개면 <새 모델이 없다>가 아니라 마크업이 바뀐 것이다 — 그걸 구분해서 보고한다.
  it('빈 결과를 성공으로 돌려주지 않는다', () => {
    expect(read('main', 'ollama-manager.ts')).toContain("error: 'no-matches'");
  });

  // ★ hf.co 이름을 Ollama 레지스트리에 물으면 있는 모델도 <없다>가 나오고, 그 false 가
  //   UI 사전 확인을 타고 설치를 막는다. 라이브에서 "확인 false / 실제 설치 성공" 으로 관측했다.
  it("hf.co 이름은 허깅페이스에 묻는다", () => {
    const mgr = read('main', 'ollama-manager.ts');
    expect(mgr).toContain('if (HF_HOSTS.has(hfSegs[0]?.toLowerCase()))');
    expect(mgr).toContain('/api/models/');
  });

  // 허깅페이스 응답도 남이 쓴 데이터다 — id 를 그대로 pull 에 넘기지 않는다.
  it('허깅페이스 결과도 모델 문법을 통과해야 한다', () => {
    const mgr = read('main', 'ollama-manager.ts');
    expect(mgr).toContain('if (isValidModelRef(ref)) models.push(ref)');
    expect(mgr).toContain("filter: 'gguf'");
  });

  it('진행률을 브로드캐스트하지 않는다 (e.sender 로만)', () => {
    expect(main).toContain("e.sender.send('ollama:pull-progress'");
    expect(main).not.toContain("webContents.getAllWebContents().forEach");
  });
});
