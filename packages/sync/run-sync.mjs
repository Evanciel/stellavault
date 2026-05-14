/**
 * 스케줄러용 런처 — 업로드 + 동기화 순차 실행 + 로그 기록
 * Windows 한글 경로에서도 안정적으로 동작
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(__dirname, 'logs');
const today = new Date().toISOString().slice(0, 10);
const logFile = path.join(logDir, `sync-${today}.log`);

fs.mkdirSync(logDir, { recursive: true });

function log(msg) {
  const ts = new Date().toLocaleString('ko-KR');
  const line = `[${ts}] ${msg}\n`;
  fs.appendFileSync(logFile, line, 'utf-8');
  process.stdout.write(line);
}

function runScript(name) {
  const script = path.join(__dirname, name);
  try {
    const output = execFileSync('node', [script], {
      cwd: __dirname,
      timeout: 1800000,
      encoding: 'utf-8',
    });
    log(output.trim().split('\n').slice(-3).join(' | '));
    return true;
  } catch (err) {
    log(`ERROR in ${name}: ${err.message}`);
    return false;
  }
}

// 2026-05-14: Stellavault reindex 추가. notion-obsidian-sync 는 매일 정상
// 작동했지만 .stellavault.db indexer 가 분리돼 있어 vault 변경 (자비스가
// 매일 만드는 +40 deep notes) 이 검색 인덱스에 반영 안 됨. watcher 코드는
// 있는데 진입점 미연결 → 매일 reindex CLI 로 우회.
//
// 2026-05-14 후속: stellavault CLI `index` 명령이 STELLAVAULT_DB_PATH env
// 무시하고 vault-path-hash 기반 default 경로 (C:\Users\<u>\.stellavault\
// vaults\<hash>.db) 에 저장. 자비스 MCP 는 F:/Obsidian/Evan/.stellavault.db
// 를 참조하므로 매번 copy 단계 필요. 5-10분 reindex + 수초 copy.
function runStellavaultIndex() {
  const vaultPath = process.env.STELLAVAULT_VAULT_PATH || 'F:/Obsidian/Evan';
  const stellavaultJs = path.resolve(__dirname, '../../dist/stellavault.js');
  try {
    const output = execFileSync('node', [stellavaultJs, 'index', vaultPath, '--no-spinner'], {
      cwd: __dirname,
      timeout: 7200000, // 2h — 4139 docs / 31k chunks 가 84분 걸린 적 있음
      encoding: 'utf-8',
    });
    log(output.trim().split('\n').slice(-3).join(' | '));
    return true;
  } catch (err) {
    log(`ERROR in stellavault index: ${err.message}`);
    return false;
  }
}

// 2026-05-14: stellavault CLI 가 vault-hash-based 경로 (C:) 에 indexed DB 를
// 저장하므로, 자비스 MCP 가 보는 F:/Obsidian/Evan/.stellavault.db 로 copy.
// 결과 line ("💾 DB: <path>") 에서 source 경로 추출 후 fs.copyFileSync.
function runStellavaultDbCopy() {
  const targetPath = process.env.STELLAVAULT_DB_PATH || 'F:/Obsidian/Evan/.stellavault.db';
  // stellavault CLI 의 default 경로 — vault path 기반 hash 가 들어가지만
  // 우리 vault 는 고정이라 6438b442.db 로 안정. 환경 변경 시 stellavault
  // doctor 로 새 hash 확인 가능.
  const sourcePath = process.env.STELLAVAULT_CLI_DB_PATH ||
    path.join(process.env.USERPROFILE || '', '.stellavault', 'vaults', '6438b442.db');
  try {
    if (!fs.existsSync(sourcePath)) {
      log(`ERROR copy: source not found ${sourcePath}`);
      return false;
    }
    // 자비스가 동시에 read 중일 수 있으므로 atomic-ish copy: tmp 만들고 rename
    const tmp = targetPath + '.tmp';
    fs.copyFileSync(sourcePath, tmp);
    // 기존 WAL/SHM 제거 — 새 DB 와 mismatch 방지
    for (const ext of ['-wal', '-shm']) {
      try { fs.unlinkSync(targetPath + ext); } catch {}
    }
    fs.renameSync(tmp, targetPath);
    const stat = fs.statSync(targetPath);
    log(`copied DB: ${sourcePath} → ${targetPath} (${Math.round(stat.size / 1e6)}MB)`);
    return true;
  } catch (err) {
    log(`ERROR copy: ${err.message}`);
    return false;
  }
}

log('===== START =====');
log('[1/4] Upload PDCA to Notion');
runScript('upload-pdca-to-notion.mjs');
log('[2/4] Sync Notion to Obsidian');
runScript('sync-to-obsidian.mjs');
log('[3/4] Stellavault reindex');
runStellavaultIndex();
log('[4/4] Copy DB to Jarvis-visible path');
runStellavaultDbCopy();
log('===== DONE =====');
