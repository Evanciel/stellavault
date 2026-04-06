// YouTube 콘텐츠 추출기 — 자막 + 메타데이터 → 구조화된 노트

export interface YouTubeContent {
  title: string;
  channelName: string;
  description: string;
  transcript: string;
  duration: string;
  publishDate: string;
  tags: string[];
  url: string;
  summary: string; // 자동 생성 요약
}

/**
 * YouTube URL에서 메타데이터 + 자막을 추출.
 * 자막은 페이지 HTML에 내장된 timedtext 데이터에서 가져옴.
 */
export async function extractYouTubeContent(url: string): Promise<YouTubeContent> {
  const html = await fetchPage(url);

  const title = extractMeta(html, 'og:title') ?? extractBetween(html, '<title>', '</title>') ?? 'Untitled';
  const channelName = extractMeta(html, 'og:site_name') ?? extractBetween(html, '"ownerChannelName":"', '"') ?? '';
  const description = extractMeta(html, 'og:description') ?? '';
  const duration = extractBetween(html, '"lengthSeconds":"', '"') ?? '';
  const publishDate = extractBetween(html, '"publishDate":"', '"') ?? '';
  const videoUrl = extractMeta(html, 'og:url') ?? url;

  // 자막 추출 시도
  let transcript = '';
  try {
    transcript = await extractTranscript(html, url);
  } catch {
    // 자막 없으면 description만 사용
  }

  // 자동 태그 추출 (제목 + 설명에서 키워드)
  const tags = extractKeywords(title, description);

  // 자동 요약 (자막 기반)
  const summary = generateSummary(title, description, transcript);

  return {
    title: cleanHtml(title),
    channelName: cleanHtml(channelName),
    description: cleanHtml(description),
    transcript,
    duration: formatDuration(duration),
    publishDate,
    tags,
    url: videoUrl,
    summary,
  };
}

/**
 * 추출된 콘텐츠를 Stellavault 노트 포맷으로 변환.
 */
export function formatYouTubeNote(content: YouTubeContent): string {
  const lines = [
    '---',
    `title: "${content.title.replace(/"/g, "'")}"`,
    'type: literature',
    `source: ${content.url}`,
    'input_type: youtube',
    `channel: "${content.channelName}"`,
    `duration: "${content.duration}"`,
    content.publishDate ? `published: ${content.publishDate}` : null,
    `tags: [${['youtube', ...content.tags].map(t => `"${t}"`).join(', ')}]`,
    `created: ${new Date().toISOString()}`,
    `summary: "${content.summary.slice(0, 150).replace(/"/g, "'").replace(/\n/g, ' ')}"`,
    '---',
    '',
    `# ${content.title}`,
    '',
    `> Channel: **${content.channelName}** | Duration: ${content.duration}`,
    `> Source: ${content.url}`,
    '',
  ];

  // 요약
  if (content.summary) {
    lines.push('## 요약', '', content.summary, '');
  }

  // 설명
  if (content.description && content.description.length > 20) {
    lines.push('## 설명', '', content.description.slice(0, 1000), '');
  }

  // 자막 (섹션별로 나누기)
  if (content.transcript) {
    lines.push('## 주요 내용', '');
    const sections = splitTranscriptIntoSections(content.transcript);
    for (const section of sections) {
      lines.push(`### ${section.heading}`, '', section.text, '');
    }
  }

  lines.push('---', `*Extracted from YouTube by Stellavault at ${new Date().toISOString()}*`);

  return lines.filter(l => l !== null).join('\n');
}

// ─── 내부 함수들 ───

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

async function extractTranscript(html: string, videoUrl: string): Promise<string> {
  // 방법 1: YouTube 페이지 내 captionTracks에서 자막 URL 추출
  const captionMatch = html.match(/"captionTracks":\[(.*?)\]/);
  if (!captionMatch) return '';

  // 한국어 > 영어 > 자동 생성 순서로 찾기
  const tracks = captionMatch[1];
  let captionUrl = '';

  // 한국어 자막
  const koMatch = tracks.match(/"baseUrl":"(.*?)".*?"languageCode":"ko"/);
  if (koMatch) captionUrl = koMatch[1];

  // 영어 자막
  if (!captionUrl) {
    const enMatch = tracks.match(/"baseUrl":"(.*?)".*?"languageCode":"en"/);
    if (enMatch) captionUrl = enMatch[1];
  }

  // 아무 자막
  if (!captionUrl) {
    const anyMatch = tracks.match(/"baseUrl":"(.*?)"/);
    if (anyMatch) captionUrl = anyMatch[1];
  }

  if (!captionUrl) return '';

  // 자막 XML 가져오기
  const cleanUrl = captionUrl.replace(/\\u0026/g, '&');
  const captionResp = await fetch(cleanUrl, { signal: AbortSignal.timeout(10000) });
  const xml = await captionResp.text();

  // XML에서 텍스트 추출
  const textParts: string[] = [];
  const matches = xml.matchAll(/<text[^>]*>(.*?)<\/text>/g);
  for (const m of matches) {
    const text = m[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();
    if (text) textParts.push(text);
  }

  return textParts.join(' ');
}

function extractMeta(html: string, property: string): string | undefined {
  const match = html.match(new RegExp(`<meta[^>]*property="${property}"[^>]*content="([^"]*)"`, 'i'))
    ?? html.match(new RegExp(`<meta[^>]*name="${property}"[^>]*content="([^"]*)"`, 'i'));
  return match?.[1];
}

function extractBetween(html: string, start: string, end: string): string | undefined {
  const idx = html.indexOf(start);
  if (idx < 0) return undefined;
  const startIdx = idx + start.length;
  const endIdx = html.indexOf(end, startIdx);
  if (endIdx < 0) return undefined;
  return html.substring(startIdx, endIdx);
}

function cleanHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n/g, ' ')
    .trim();
}

function formatDuration(seconds: string): string {
  const s = parseInt(seconds);
  if (isNaN(s)) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function extractKeywords(title: string, description: string): string[] {
  const text = `${title} ${description}`.toLowerCase();
  const words = text.split(/[\s,.\-_#|]+/).filter(w => w.length > 3);

  // 빈도 기반 키워드 추출
  const freq = new Map<string, number>();
  const stopwords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'will', 'about', 'your', 'more', 'what', 'http', 'https', 'www']);
  for (const w of words) {
    if (stopwords.has(w) || /^\d+$/.test(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);
}

function generateSummary(title: string, description: string, transcript: string): string {
  if (transcript.length > 100) {
    // 자막 첫 500자 + 마지막 200자를 요약으로
    const intro = transcript.slice(0, 500).trim();
    const outro = transcript.length > 700 ? transcript.slice(-200).trim() : '';

    return [
      `**${title}**`,
      '',
      intro + (transcript.length > 500 ? '...' : ''),
      '',
      outro ? `(결론) ${outro}` : '',
    ].filter(Boolean).join('\n');
  }

  // 자막 없으면 설명 사용
  if (description.length > 50) {
    return description.slice(0, 500);
  }

  return `${title} — YouTube 영상`;
}

function splitTranscriptIntoSections(transcript: string, sectionSize = 500): Array<{ heading: string; text: string }> {
  const words = transcript.split(' ');
  const sections: Array<{ heading: string; text: string }> = [];
  let currentWords: string[] = [];
  let sectionNum = 1;

  for (const word of words) {
    currentWords.push(word);
    if (currentWords.length >= sectionSize / 5) { // ~100 words per section
      const text = currentWords.join(' ');
      const heading = text.slice(0, 40).replace(/[^\w가-힣\s]/g, '').trim() + '...';
      sections.push({ heading: `파트 ${sectionNum}`, text });
      currentWords = [];
      sectionNum++;
    }
  }

  if (currentWords.length > 0) {
    sections.push({ heading: `파트 ${sectionNum}`, text: currentWords.join(' ') });
  }

  return sections;
}
