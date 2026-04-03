// Voice Knowledge Capture (P3-F25)
// 음성 파일 → 텍스트 → 자동 분류 → vault 저장 → 인덱싱

import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// CRIT-03: 화이트리스트 검증
const ALLOWED_MODELS = ['tiny', 'base', 'small', 'medium', 'large'];
const ALLOWED_LANGUAGES = ['auto', 'en', 'ko', 'ja', 'zh', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi'];

function validateModel(model: string): string {
  if (!ALLOWED_MODELS.includes(model)) throw new Error(`Invalid model: ${model}. Allowed: ${ALLOWED_MODELS.join(', ')}`);
  return model;
}

function validateLanguage(lang: string): string {
  if (!ALLOWED_LANGUAGES.includes(lang)) throw new Error(`Invalid language: ${lang}. Allowed: ${ALLOWED_LANGUAGES.join(', ')}`);
  return lang;
}

export interface CaptureResult {
  title: string;
  filePath: string;
  transcript: string;
  duration?: number;
  tags: string[];
  success: boolean;
  error?: string;
}

export interface CaptureOptions {
  vaultPath: string;
  folder?: string;      // default: 01_Knowledge/voice
  language?: string;     // default: auto
  model?: string;        // whisper model: tiny, base, small, medium, large
  tags?: string[];
  type?: string;
}

// Whisper CLI가 설치되어 있는지 확인
export function isWhisperAvailable(): boolean {
  try {
    execSync('whisper --help', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 음성 파일 → 텍스트 변환 (Whisper CLI)
export async function transcribeAudio(audioPath: string, options: { model?: string; language?: string } = {}): Promise<string> {
  const { model = 'base', language } = options;

  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  // CRIT-03 fix: execFileSync + 화이트리스트 검증 (command injection 방지)
  if (isWhisperAvailable()) {
    const safeModel = validateModel(model);
    const args = [audioPath, '--model', safeModel, '--output_format', 'txt', '--output_dir', '/tmp/sv-whisper'];
    if (language) args.push('--language', validateLanguage(language));
    mkdirSync('/tmp/sv-whisper', { recursive: true });

    try {
      execFileSync('whisper', args, { stdio: 'pipe', timeout: 300000 });
      const outputName = basename(audioPath).replace(/\.[^.]+$/, '.txt');
      const { readFileSync } = await import('node:fs');
      return readFileSync(join('/tmp/sv-whisper', outputName), 'utf-8').trim();
    } catch (err) {
      throw new Error(`Whisper failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Whisper 없으면 에러
  throw new Error('Whisper not installed. Install: pip install openai-whisper');
}

// 트랜스크립트에서 자동 태그 추출 (간단한 키워드 매칭)
function autoTag(text: string): string[] {
  const tags: string[] = [];
  const lower = text.toLowerCase();

  const keywords: Record<string, string[]> = {
    'meeting': ['meeting', 'discuss', '미팅', '회의'],
    'decision': ['decide', 'agreed', '결정', '합의'],
    'idea': ['idea', 'thought', '아이디어', '생각'],
    'todo': ['todo', 'task', 'action item', '할 일'],
    'bug': ['bug', 'error', 'fix', '버그', '에러'],
    'architecture': ['architecture', 'design', 'system', '아키텍처', '설계'],
  };

  for (const [tag, words] of Object.entries(keywords)) {
    if (words.some(w => lower.includes(w))) tags.push(tag);
  }

  return tags;
}

// 음성 → vault 노트 생성
export async function captureVoice(audioPath: string, options: CaptureOptions): Promise<CaptureResult> {
  const { vaultPath, folder = '01_Knowledge/voice', type = 'note', tags: userTags = [] } = options;

  try {
    // 1. 음성→텍스트
    const transcript = await transcribeAudio(audioPath, {
      model: options.model,
      language: options.language,
    });

    if (!transcript) {
      return { title: '', filePath: '', transcript: '', tags: [], success: false, error: 'Empty transcript' };
    }

    // 2. 제목 생성 (첫 문장 또는 첫 30자)
    const firstLine = transcript.split(/[.\n!?]/)[0]?.trim() || transcript.slice(0, 30);
    const title = firstLine.slice(0, 60);
    const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();

    // 3. 자동 태그
    const autoTags = autoTag(transcript);
    const allTags = [...new Set([...userTags, ...autoTags, 'voice'])];

    // 4. frontmatter + 마크다운 생성
    const date = new Date().toISOString();
    const content = [
      '---',
      `title: "${safeTitle}"`,
      `source: voice`,
      `type: ${type}`,
      `tags: [${allTags.map(t => `"${t}"`).join(', ')}]`,
      `captured: ${date}`,
      `audio: ${basename(audioPath)}`,
      '---',
      '',
      `# ${safeTitle}`,
      '',
      `> Voice capture: ${date.slice(0, 10)}`,
      '',
      transcript,
      '',
    ].join('\n');

    // 5. vault에 저장
    const dir = join(vaultPath, folder);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${date.slice(0, 10)} ${safeTitle}.md`);
    writeFileSync(filePath, content, 'utf-8');

    return {
      title: safeTitle,
      filePath,
      transcript,
      tags: allTags,
      success: true,
    };
  } catch (err) {
    return {
      title: '',
      filePath: '',
      transcript: '',
      tags: [],
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
