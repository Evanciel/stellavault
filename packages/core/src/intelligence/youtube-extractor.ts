// YouTube 콘텐츠 추출기 v2 — 자막(타임스탬프 보존) + 메타데이터 → 구조화 노트
// PM 분석 반영: HTML 엔티티, 채널명, 이중 frontmatter, 태그 품질, 요약 품질

import { nt } from '../i18n/note-strings.js';

export interface YouTubeContent {
  title: string;
  channelName: string;
  description: string;
  transcript: TimedSegment[];
  rawTranscript: string;
  duration: string;
  publishDate: string;
  tags: string[];
  url: string;
  videoId: string;
  viewCount: string;
  thumbnail: string;
  summary: string;
}

export interface TimedSegment {
  startTime: number; // 초
  text: string;
}

/**
 * YouTube URL에서 모든 콘텐츠 추출.
 * 반환값은 데이터만 — 노트 포맷팅은 별도.
 */
export async function extractYouTubeContent(url: string): Promise<YouTubeContent> {
  const html = await fetchPage(url);

  // 메타데이터 (cleanHtml 먼저 적용)
  const title = cleanHtml(extractMeta(html, 'og:title') ?? extractBetween(html, '<title>', '</title>') ?? 'Untitled');
  const channelName = cleanHtml(
    extractBetween(html, '"ownerChannelName":"', '"')
    ?? extractBetween(html, '"author":"', '"')
    ?? 'Unknown Channel'
  );
  // 전체 설명 가져오기 (og:description은 ~150자로 잘림)
  const description = cleanHtml(extractFullDescription(html));
  const duration = extractBetween(html, '"lengthSeconds":"', '"') ?? '';
  const publishDate = extractBetween(html, '"publishDate":"', '"') ?? '';
  const viewCount = extractBetween(html, '"viewCount":"', '"') ?? '';
  const thumbnail = extractMeta(html, 'og:image') ?? '';
  const videoId = extractVideoId(url);

  // 자막 (타임스탬프 보존)
  let transcript: TimedSegment[] = [];
  let rawTranscript = '';
  try {
    transcript = await extractTimedTranscript(html, videoId);
    rawTranscript = transcript.map(s => s.text).join(' ');
  } catch { /* 자막 없음 */ }

  // 태그 (cleanHtml 적용된 데이터에서 추출)
  const tags = extractSmartTags(title, description);

  // 요약 (문장 중요도 기반)
  const summary = generateSmartSummary(title, rawTranscript, description);

  return {
    title, channelName, description, transcript, rawTranscript,
    duration: formatDuration(duration), publishDate, tags, url,
    videoId, viewCount, thumbnail, summary,
  };
}

/**
 * 추출된 콘텐츠 → Stellavault .md 노트 (frontmatter 포함하지 않음 — pipeline이 처리).
 */
export function formatYouTubeNote(content: YouTubeContent): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${content.title}`, '');
  lines.push(`> **${content.channelName}** | ${content.duration} | ${content.publishDate?.split('T')[0] ?? ''}`);
  if (content.viewCount) lines.push(`> ${nt('views')}: ${Number(content.viewCount).toLocaleString()}`);
  lines.push(`> ${content.url}`, '');

  if (content.summary) {
    lines.push(`## ${nt('summary')}`, '', content.summary, '');
  }

  if (content.description.length > 30) {
    lines.push(`## ${nt('description')}`, '', content.description.slice(0, 3000), '');
  }

  if (content.transcript.length > 0) {
    lines.push(`## ${nt('transcript')}`, '');
    const segments = groupIntoSegments(content.transcript);
    for (const seg of segments) {
      const ts = formatSeconds(seg.startTime);
      const ytLink = `https://youtu.be/${content.videoId}?t=${Math.floor(seg.startTime)}`;
      lines.push(`### [${ts}](${ytLink})`, '', seg.text, '');
    }
  }

  return lines.join('\n');
}

// ─── 자막 추출 (타임스탬프 보존) ───

async function extractTimedTranscript(html: string, videoId?: string): Promise<TimedSegment[]> {
  // 1차: HTML에서 captionTracks URL 직접 fetch
  const segments = await extractTimedTranscriptFromHtml(html);
  if (segments.length > 0) return segments;

  // 2차: yt-dlp fallback (YouTube bot 보호 우회)
  if (videoId) return extractTimedTranscriptViaTool(videoId);
  return [];
}

async function extractTimedTranscriptFromHtml(html: string): Promise<TimedSegment[]> {
  const captionMatch = html.match(/"captionTracks":\[(.*?)\]/);
  if (!captionMatch) return [];

  const tracks = captionMatch[1];
  let captionUrl = '';

  const allUrls = [...tracks.matchAll(/"baseUrl":"(.*?)"/g)].map(m => m[1]);
  const allLangs = [...tracks.matchAll(/"languageCode":"(.*?)"/g)].map(m => m[1]);

  for (const targetLang of ['ko', 'en']) {
    const idx = allLangs.indexOf(targetLang);
    if (idx >= 0 && allUrls[idx]) { captionUrl = allUrls[idx]; break; }
  }
  if (!captionUrl && allUrls.length > 0) captionUrl = allUrls[0];
  if (!captionUrl) return [];

  const cleanUrl = captionUrl.replace(/\\u0026/g, '&').replace(/\\u003d/g, '=').replace(/\\\//g, '/');
  const resp = await fetch(cleanUrl, { signal: AbortSignal.timeout(10000) });
  const xml = await resp.text();
  return parseTranscriptXml(xml);
}

async function extractTimedTranscriptViaTool(videoId: string): Promise<TimedSegment[]> {
  const { execSync } = await import('node:child_process');
  const { readdirSync, readFileSync, unlinkSync } = await import('node:fs');
  const { join } = await import('node:path');
  const tmpDir = (await import('node:os')).tmpdir();
  const tmpBase = join(tmpDir, `sv-sub-${videoId}`);
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  // Try each language separately to avoid partial failure aborting everything
  for (const lang of ['ko', 'en']) {
    try {
      execSync(
        `python -m yt_dlp --write-auto-sub --sub-lang ${lang} --skip-download --sub-format srv1 -o "${tmpBase}" "${url}"`,
        { timeout: 30000, stdio: 'pipe' },
      );
    } catch { /* lang not available — try next */ continue; }

    // Find the subtitle file
    const files = readdirSync(tmpDir).filter(f =>
      f.startsWith(`sv-sub-${videoId}`) && f.endsWith('.srv1'),
    );
    if (files.length === 0) continue;

    const xml = readFileSync(join(tmpDir, files[0]), 'utf-8');
    // Cleanup
    for (const f of files) { try { unlinkSync(join(tmpDir, f)); } catch { /* ok */ } }

    const segments = parseTranscriptXml(xml);
    if (segments.length > 0) return segments;
  }
  return [];
}

function parseTranscriptXml(xml: string): TimedSegment[] {
  if (!xml || xml.length === 0) return [];
  const segments: TimedSegment[] = [];
  const matches = xml.matchAll(/<text start="([^"]+)"[^>]*>(.*?)<\/text>/g);
  for (const m of matches) {
    const text = cleanHtml(m[2]).trim();
    if (text) segments.push({ startTime: parseFloat(m[1]), text });
  }
  return segments;
}

function groupIntoSegments(timedTexts: TimedSegment[], gapThreshold = 30): Array<{ startTime: number; text: string }> {
  const segments: Array<{ startTime: number; texts: string[] }> = [];
  let current: { startTime: number; texts: string[] } | null = null;
  let lastStart = 0;

  for (const item of timedTexts) {
    if (!current || (item.startTime - lastStart > gapThreshold)) {
      if (current) segments.push(current);
      current = { startTime: item.startTime, texts: [] };
    }
    current!.texts.push(item.text);
    lastStart = item.startTime;
  }
  if (current) segments.push(current);

  return segments.map(s => ({ startTime: s.startTime, text: s.texts.join(' ') }));
}

// ─── 태그 추출 (한국어 조사 처리) ───

function extractSmartTags(title: string, description: string): string[] {
  const text = `${title} ${title} ${description}`; // 제목 가중치 2배
  const koSuffixes = ['에서는', '에서', '에게', '까지', '부터', '으로', '에는', '와', '과', '을', '를', '이', '가', '은', '는', '의', '에', '로', '도', '만'];
  const stopwords = new Set([
    'this', 'that', 'with', 'from', 'have', 'been', 'will', 'about',
    'your', 'more', 'what', 'http', 'https', 'www', 'youtube', 'com',
    '이번', '영상', '에서', '있는', '하는', '것을', '합니다', '있습니다',
    '안녕하세요', '바이브랩스입니다', '됩니다', '그리고', '하지만', '이렇게',
  ]);

  const tokens = text.split(/[\s,.\-_#|?!'"()\[\]{}:;]+/).filter(Boolean);
  const freq = new Map<string, number>();

  for (let token of tokens) {
    // 한국어 조사 제거
    if (token.length > 2) {
      for (const suffix of koSuffixes) {
        if (token.endsWith(suffix) && token.length - suffix.length >= 2) {
          token = token.slice(0, -suffix.length);
          break;
        }
      }
    }
    if (token.length < 2 || /^\d+$/.test(token) || stopwords.has(token.toLowerCase())) continue;
    if (/&[a-z]+;|&#\d+;/.test(token)) continue;
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w);
}

// ─── 요약 (문장 중요도 기반) ───

function generateSmartSummary(title: string, transcript: string, description: string): string {
  const source = transcript.length > 100 ? transcript : description;
  if (source.length < 50) return `${title} — ${nt('youtubeVideo')}`;

  const sentences = source
    .split(/[.。!?]\s+|(?<=다)\s+|(?<=요)\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 15 && s.length < 300);

  if (sentences.length <= 3) return sentences.join(' ');

  const titleWords = new Set(
    title.split(/[\s,.\-_]+/).filter(w => w.length > 2).map(w => w.toLowerCase())
  );

  const scored = sentences.map((sentence, idx) => {
    let score = 0;
    const words = sentence.toLowerCase().split(/\s+/);
    for (const w of words) { if (titleWords.has(w)) score += 3; }

    const pos = idx / sentences.length;
    if (pos > 0.15 && pos < 0.4) score += 2;
    if (pos > 0.6 && pos < 0.85) score += 1;
    if (pos < 0.05) score -= 3; // 인트로 인사 강력 패널티

    if (/\d+/.test(sentence)) score += 1;
    return { sentence, score, idx };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .sort((a, b) => a.idx - b.idx)
    .map(s => s.sentence)
    .join(' ');
}

// ─── 유틸 ───

function extractFullDescription(html: string): string {
  // 방법 1: JSON에서 shortDescription 추출 (이스케이프된 JSON 문자열)
  const shortDescMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  if (shortDescMatch) {
    try {
      return JSON.parse(`"${shortDescMatch[1]}"`);
    } catch { /* fallback */ }
  }

  // 방법 2: description.simpleText
  const simpleMatch = html.match(/"description":\{"simpleText":"((?:[^"\\]|\\.)*)"/);
  if (simpleMatch) {
    try {
      return JSON.parse(`"${simpleMatch[1]}"`);
    } catch { /* fallback */ }
  }

  // 방법 3: og:description (짧지만 최후 수단)
  return extractMeta(html, 'og:description') ?? '';
}

async function fetchPage(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });
  return resp.text();
}

function extractMeta(html: string, property: string): string | undefined {
  const match = html.match(new RegExp(`<meta[^>]*property="${property}"[^>]*content="([^"]*)"`, 'i'))
    ?? html.match(new RegExp(`<meta[^>]*name="${property}"[^>]*content="([^"]*)"`, 'i'));
  return match?.[1];
}

function extractBetween(html: string, start: string, end: string): string | undefined {
  const idx = html.indexOf(start);
  if (idx < 0) return undefined;
  const s = idx + start.length;
  const e = html.indexOf(end, s);
  if (e < 0) return undefined;
  return html.substring(s, e);
}

function cleanHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\\n/g, ' ').replace(/\n/g, ' ')
    .trim();
}

function formatDuration(seconds: string): string {
  const s = parseInt(seconds);
  if (isNaN(s)) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function extractVideoId(url: string): string {
  try {
    const u = new URL(url);
    return u.searchParams.get('v') ?? u.pathname.split('/').pop() ?? '';
  } catch { return ''; }
}
