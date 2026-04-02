/**
 * Windows 작업 스케줄러 설정 스크립트
 *
 * 기능:
 * - 매일 오전 7시에 sync-to-obsidian.mjs 자동 실행
 * - 작업 이름: NotionToObsidianSync
 * - 실행 로그를 logs/ 폴더에 저장
 *
 * 사용법: node setup-scheduler.mjs
 * 제거: node setup-scheduler.mjs --remove
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── 경로 계산 ───
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, 'sync-to-obsidian.mjs');
const LOG_DIR = path.join(__dirname, 'logs');
const TASK_NAME = 'NotionToObsidianSync';

// ─── 실행 배치 파일 생성 ───
function createBatchFile() {
  const batchPath = path.join(__dirname, 'run-sync.bat');
  const logFile = path.join(LOG_DIR, 'sync-%DATE:~0,4%-%DATE:~5,2%-%DATE:~8,2%.log');

  const batchContent = `@echo off
REM 로컬 PDCA 업로드 + 노션→옵시디언 자동 동기화 (Windows 작업 스케줄러용)
REM 생성일: ${new Date().toISOString().slice(0, 10)}

cd /d "${__dirname}"
mkdir logs 2>nul

echo [%DATE% %TIME%] ===== 업로드+동기화 시작 ===== >> "${logFile}"

echo [%DATE% %TIME%] [1/2] 로컬 PDCA → 노션 업로드 >> "${logFile}"
node "${path.join(__dirname, 'upload-pdca-to-notion.mjs')}" >> "${logFile}" 2>&1
echo [%DATE% %TIME%] 업로드 완료 (exit code: %ERRORLEVEL%) >> "${logFile}"

echo [%DATE% %TIME%] [2/2] 노션 → 옵시디언 동기화 >> "${logFile}"
node "${SCRIPT_PATH}" >> "${logFile}" 2>&1
echo [%DATE% %TIME%] 동기화 완료 (exit code: %ERRORLEVEL%) >> "${logFile}"

echo [%DATE% %TIME%] ===== 전체 완료 ===== >> "${logFile}"
`;

  fs.writeFileSync(batchPath, batchContent, 'utf-8');
  console.log(`✅ 배치 파일 생성: ${batchPath}`);
  return batchPath;
}

// ─── 작업 스케줄러 등록 ───
function registerTask(batchPath) {
  // 기존 작업 삭제 (존재하는 경우)
  try {
    execSync(`schtasks /delete /tn "${TASK_NAME}" /f`, { stdio: 'pipe' });
    console.log(`🗑️ 기존 작업 "${TASK_NAME}" 삭제됨`);
  } catch {
    // 작업이 없으면 무시
  }

  // 새 작업 등록 (매일 오전 7시) — Node.js 런처 사용 (한글 경로 안정)
  const runScript = path.join(__dirname, 'run-sync.mjs');
  // node 절대경로 사용 — 스케줄러 실행 계정에서 PATH가 다를 수 있음
  const nodePath = process.execPath;
  const cmd = `schtasks /create /tn "${TASK_NAME}" /tr "\\"${nodePath}\\" \\"${runScript}\\"" /sc daily /st 07:00 /f`;

  try {
    execSync(cmd, { stdio: 'pipe' });
    console.log(`✅ 작업 스케줄러 등록 완료: "${TASK_NAME}"`);
    console.log(`   ⏰ 실행 시간: 매일 오전 7:00`);
    console.log(`   📄 실행 파일: ${batchPath}`);
    console.log(`   📁 로그 경로: ${LOG_DIR}/`);
  } catch (err) {
    console.error(`❌ 작업 등록 실패: ${err.message}`);
    console.log('');
    console.log('💡 관리자 권한으로 다시 시도해주세요:');
    console.log(`   ${cmd}`);
  }
}

// ─── 작업 제거 ───
function removeTask() {
  try {
    execSync(`schtasks /delete /tn "${TASK_NAME}" /f`, { stdio: 'pipe' });
    console.log(`✅ 작업 "${TASK_NAME}" 제거 완료`);
  } catch {
    console.log(`ℹ️ 작업 "${TASK_NAME}"이 존재하지 않습니다.`);
  }
}

// ─── 메인 실행 ───
const args = process.argv.slice(2);

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║  ⏰ 동기화 스케줄러 설정                      ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');

if (args.includes('--remove')) {
  removeTask();
} else {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const batchPath = createBatchFile();
  registerTask(batchPath);

  console.log('');
  console.log('📋 확인 명령어:');
  console.log(`   schtasks /query /tn "${TASK_NAME}" /v /fo list`);
  console.log('');
  console.log('🧪 수동 테스트:');
  console.log(`   node "${SCRIPT_PATH}"`);
  console.log('');
  console.log('🗑️ 제거:');
  console.log(`   node "${path.basename(new URL(import.meta.url).pathname)}" --remove`);
}
