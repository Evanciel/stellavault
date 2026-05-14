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
// 있는데 진입점 미연결 → 매일 reindex CLI 로 우회. 1215 docs / 28k chunks
// 기준 5-10분, embed cache 가 hit 면 더 빨라짐.
function runStellavaultIndex() {
  const vaultPath = process.env.STELLAVAULT_VAULT_PATH || 'F:/Obsidian/Evan';
  const stellavaultJs = path.resolve(__dirname, '../../dist/stellavault.js');
  try {
    const output = execFileSync('node', [stellavaultJs, 'index', vaultPath, '--no-spinner'], {
      cwd: __dirname,
      timeout: 1800000,
      encoding: 'utf-8',
    });
    log(output.trim().split('\n').slice(-3).join(' | '));
    return true;
  } catch (err) {
    log(`ERROR in stellavault index: ${err.message}`);
    return false;
  }
}

log('===== START =====');
log('[1/3] Upload PDCA to Notion');
runScript('upload-pdca-to-notion.mjs');
log('[2/3] Sync Notion to Obsidian');
runScript('sync-to-obsidian.mjs');
log('[3/3] Stellavault reindex');
runStellavaultIndex();
log('===== DONE =====');
