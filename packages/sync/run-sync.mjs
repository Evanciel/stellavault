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

log('===== START =====');
log('[1/2] Upload PDCA to Notion');
runScript('upload-pdca-to-notion.mjs');
log('[2/2] Sync Notion to Obsidian');
runScript('sync-to-obsidian.mjs');
log('===== DONE =====');
