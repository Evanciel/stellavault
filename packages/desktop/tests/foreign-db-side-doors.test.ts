// 🔴 소유가 확인되지 않은 DB 에 <옆문으로> 쓰는 경로를 막았는지 잰다 (코덱스 16차).
//
// ⚠️ 이 파일이 재는 것을 정직하게 적는다: 대부분 <소스의 모양>이다. `main/index.ts` 는
//    Electron 앱을 통째로 세우므로(BrowserWindow · ipcMain · 실제 임베더) 시험에서
//    실행할 수 없다. 그래서 약한 시험이고, 조건이 뒤집히는 회귀는 못 잡는다.
//    ★ 실행할 수 있는 조각(`runFullIndex`)은 <동작으로> 따로 잰다 → run-index.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const main = () => readFileSync(join(SRC, 'main', 'index.ts'), 'utf-8');
const engine = () => readFileSync(join(SRC, 'main', 'orchestration', 'engine.ts'), 'utf-8');
const ipcTypes = () => readFileSync(join(SRC, 'shared', 'ipc-types.ts'), 'utf-8');

describe('capture 는 색인이 거부되면 decay 도 안 쓴다 (16차 P1)', () => {
  // 🔴 `recordCapture` 는 이름과 달리 DB 에 <쓴다>(access_log INSERT · decay_state UPSERT).
  //    색인이 소유권 때문에 아무것도 안 했는데 이것만 쓰면 "증거가 없으면 한 글자도
  //    안 쓴다" 가 그 자리에서 거짓이 된다.
  it('★ 엔진의 indexFile 이 <판정을 반환하는> 타입이다 — void 면 소비할 수가 없다', () => {
    expect(engine()).toMatch(/indexFile:\s*\(absPath: string\)\s*=>\s*Promise<boolean>/);
  });

  it('★★ recordCapture 가 그 판정 <뒤에> 조건부로 걸려 있다', () => {
    const s = engine();
    expect(s).toMatch(/const indexed = await d\.indexFile\(absPath\);/);
    expect(s).toMatch(/if \(indexed\) d\.recordCapture\(absPath\);/);
    // 무조건 부르는 옛 모양이 남아 있으면 두 곳이 갈린다.
    expect(s).not.toMatch(/^\s*d\.recordCapture\(absPath\);/m);
  });

  it('★ main 의 indexFile 구현이 판정을 <돌려준다> — 버리면 위 조건이 항상 참이 된다', () => {
    const s = main();
    const i = s.indexOf('indexFile: async (abs: string)');
    expect(i, 'capture 의 indexFile 을 못 찾았다 — 이 시험이 눈이 멀었다').toBeGreaterThan(0);
    const body = s.slice(i, i + 900);
    expect(body).toContain('const ok = await indexAndReport(');
    expect(body).toContain('return ok;');
  });
});

describe('색인 판정(ok)이 렌더러까지 <실려 간다> (16차 P2)', () => {
  it('★ IPC 타입에 ok 가 있다', () => {
    const t = ipcTypes();
    const i = t.indexOf("'core:index'");
    expect(i).toBeGreaterThan(0);
    expect(t.slice(i, i + 400)).toMatch(/ok:\s*boolean/);
  });

  it('★★ 핸들러가 <계산한 값>을 싣는다 — 상수면 판정이 죽는다', () => {
    const s = main();
    const i = s.indexOf("ipcMain.handle('core:index'");
    expect(i).toBeGreaterThan(0);
    const body = s.slice(i, i + 1600);
    expect(body).toContain('ok: s.ok');
    expect(body, 'ok 를 상수로 굳히면 판정이 사라진다').not.toMatch(/ok:\s*(true|false)\s*,\s*\}/);
  });

  it('★ 엔진 미준비 조기 반환도 ok:false 다 — 성공으로 돌려주면 빈 볼트로 읽힌다', () => {
    const s = main();
    const i = s.indexOf("ipcMain.handle('core:index'");
    const body = s.slice(i, i + 700);
    expect(body).toContain('엔진이 아직 준비되지 않았다');
    expect(body).toMatch(/ok:\s*false/);
  });
});

describe('엔진이 서지 않았으면 core:ready 를 <보내지 않는다> (16차 P2)', () => {
  it('★★ initCore().then 의 send 가 coreReady 로 막혀 있다', () => {
    const s = main();
    const i = s.indexOf('void initCore(config).then(');
    expect(i, 'initCore 호출부를 못 찾았다').toBeGreaterThan(0);
    const body = s.slice(i, i + 700);
    expect(body).toContain("if (coreReady) win.webContents.send('core:ready')");
    // 같은 블록에 <무조건> 보내는 줄이 남아 있으면 가드가 무의미하다.
    expect(body).not.toMatch(/^\s*win\.webContents\.send\('core:ready'\);/m);
  });

  it('★ 그때 이유를 남긴다 — 조용히 멈추면 사용자는 영원히 기다린다', () => {
    const s = main();
    const i = s.indexOf('void initCore(config).then(');
    expect(s.slice(i, i + 700)).toMatch(/console\.error\(/);
  });
});
