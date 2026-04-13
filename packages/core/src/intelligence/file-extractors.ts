// Design Ref: §file-ingest-v2 — Binary file text extraction dispatchers
// Plan SC: SC1-SC5 (format-specific extraction + fallback)

import { readFileSync, statSync } from 'node:fs';
import { extname, basename } from 'node:path';

export interface ExtractedContent {
  text: string;
  metadata: {
    title?: string;
    author?: string;
    pageCount?: number;
    wordCount: number;
  };
  sourceFormat: 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'xls' | 'text';
}

const BINARY_EXTS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.xls']);

export function isBinaryFormat(filePath: string): boolean {
  return BINARY_EXTS.has(extname(filePath).toLowerCase());
}

/**
 * 파일 경로에서 텍스트 추출. 확장자 기반 파서 디스패치.
 * 지원: .pdf, .docx, .pptx, .xlsx, .xls
 * 미지원 확장자: utf-8 텍스트로 읽기
 */
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function extractFileContent(filePath: string): Promise<ExtractedContent> {
  const ext = extname(filePath).toLowerCase();
  const { size } = statSync(filePath);
  if (size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${Math.round(size / 1024 / 1024)}MB > 50MB limit)`);
  }
  const buffer = readFileSync(filePath);

  switch (ext) {
    case '.pdf': return extractPdf(buffer, filePath);
    case '.docx': return extractDocx(buffer, filePath);
    case '.pptx': return extractPptx(buffer, filePath);
    case '.xlsx': return extractXlsx(buffer, filePath);
    case '.xls': return extractXlsx(buffer, filePath);
    case '.json': return extractJson(filePath);
    case '.csv': return extractCsv(filePath);
    case '.xml': return extractXml(filePath);
    case '.html': case '.htm': return extractHtml(filePath);
    case '.yaml': case '.yml': return extractYaml(filePath);
    case '.rtf': return extractRtf(filePath);
    default: return extractText(filePath);
  }
}

async function extractPdf(buffer: Buffer, filePath: string): Promise<ExtractedContent> {
  try {
    const { extractText } = await import('unpdf');
    const result = await extractText(new Uint8Array(buffer));
    const text = Array.isArray(result.text) ? result.text.join('\n\n') : (result.text ?? '');
    return {
      text,
      metadata: {
        title: basename(filePath, '.pdf'),
        pageCount: result.totalPages,
        wordCount: text.split(/\s+/).filter(Boolean).length,
      },
      sourceFormat: 'pdf',
    };
  } catch (err) {
    console.error(`PDF extraction failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return fallback(filePath, 'pdf');
  }
}

async function extractDocx(buffer: Buffer, filePath: string): Promise<ExtractedContent> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.default.extractRawText({ buffer });
    const text = result.value ?? '';
    return {
      text,
      metadata: {
        title: basename(filePath, '.docx'),
        wordCount: text.split(/\s+/).filter(Boolean).length,
      },
      sourceFormat: 'docx',
    };
  } catch (err) {
    console.error(`DOCX extraction failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return fallback(filePath, 'docx');
  }
}

async function extractPptx(buffer: Buffer, filePath: string): Promise<ExtractedContent> {
  try {
    const officeparser = await import('officeparser');
    const text = String(await officeparser.default.parseOffice(buffer));
    return {
      text: text ?? '',
      metadata: {
        title: basename(filePath, '.pptx'),
        wordCount: (text ?? '').split(/\s+/).filter(Boolean).length,
      },
      sourceFormat: 'pptx',
    };
  } catch (err) {
    console.error(`PPTX extraction failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return fallback(filePath, 'pptx');
  }
}

async function extractXlsx(buffer: Buffer, filePath: string): Promise<ExtractedContent> {
  const ext = extname(filePath).toLowerCase();
  const format = ext === '.xls' ? 'xls' : 'xlsx' as const;
  try {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer);
    const parts: string[] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      // 마크다운 테이블 형식 (헤더-값 구조 보존)
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
      if (rows.length === 0) continue;

      parts.push(`## ${name}\n`);
      const headers = (rows[0] as unknown[]).map(h => String(h ?? ''));
      parts.push(`| ${headers.join(' | ')} |`);
      parts.push(`| ${headers.map(() => '---').join(' | ')} |`);
      for (const row of rows.slice(1)) {
        const cells = headers.map((_, i) => String(row[i] ?? ''));
        parts.push(`| ${cells.join(' | ')} |`);
      }
      parts.push('');

      // JSON 구조도 포함 (AI 검색/ask에서 수치 활용 가능)
      if (rows.length <= 100) {
        const jsonRows = XLSX.utils.sheet_to_json(sheet);
        if (jsonRows.length > 0) {
          parts.push(`<details><summary>Structured Data (${jsonRows.length} rows)</summary>\n`);
          parts.push('```json');
          parts.push(JSON.stringify(jsonRows.slice(0, 50), null, 2));
          parts.push('```');
          parts.push('</details>\n');
        }
      }
    }
    const text = parts.join('\n');
    return {
      text,
      metadata: {
        title: basename(filePath, ext),
        wordCount: text.split(/\s+/).filter(Boolean).length,
      },
      sourceFormat: format,
    };
  } catch (err) {
    console.error(`XLSX extraction failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return fallback(filePath, format);
  }
}

function extractText(filePath: string): ExtractedContent {
  const text = readFileSync(filePath, 'utf-8');
  return {
    text,
    metadata: {
      title: basename(filePath),
      wordCount: text.split(/\s+/).filter(Boolean).length,
    },
    sourceFormat: 'text',
  };
}

function extractJson(filePath: string): ExtractedContent {
  const raw = readFileSync(filePath, 'utf-8');
  let text: string;
  try {
    const parsed = JSON.parse(raw);
    text = '```json\n' + JSON.stringify(parsed, null, 2).slice(0, 50000) + '\n```';
  } catch {
    text = raw.slice(0, 50000);
  }
  return { text, metadata: { title: basename(filePath, '.json'), wordCount: text.split(/\s+/).filter(Boolean).length }, sourceFormat: 'text' };
}

function extractCsv(filePath: string): ExtractedContent {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());
  const headers = lines[0]?.split(',').map(h => h.trim()) ?? [];
  const mdLines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const line of lines.slice(1, 200)) {
    const cells = line.split(',').map(c => c.trim());
    mdLines.push(`| ${cells.join(' | ')} |`);
  }
  const text = mdLines.join('\n');
  return { text, metadata: { title: basename(filePath, '.csv'), wordCount: text.split(/\s+/).filter(Boolean).length }, sourceFormat: 'text' };
}

function extractXml(filePath: string): ExtractedContent {
  const raw = readFileSync(filePath, 'utf-8');
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50000);
  return { text, metadata: { title: basename(filePath, '.xml'), wordCount: text.split(/\s+/).filter(Boolean).length }, sourceFormat: 'text' };
}

function extractHtml(filePath: string): ExtractedContent {
  const raw = readFileSync(filePath, 'utf-8');
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50000);
  return { text, metadata: { title: basename(filePath, extname(filePath)), wordCount: text.split(/\s+/).filter(Boolean).length }, sourceFormat: 'text' };
}

function extractYaml(filePath: string): ExtractedContent {
  const raw = readFileSync(filePath, 'utf-8');
  const text = '```yaml\n' + raw.slice(0, 50000) + '\n```';
  return { text, metadata: { title: basename(filePath, extname(filePath)), wordCount: raw.split(/\s+/).filter(Boolean).length }, sourceFormat: 'text' };
}

function extractRtf(filePath: string): ExtractedContent {
  const raw = readFileSync(filePath, 'utf-8');
  const text = raw.replace(/\{\\[^}]*\}/g, '').replace(/\\[a-z]+\d*\s?/gi, '').replace(/[{}]/g, '').trim().slice(0, 50000);
  return { text, metadata: { title: basename(filePath, '.rtf'), wordCount: text.split(/\s+/).filter(Boolean).length }, sourceFormat: 'text' };
}

function fallback(filePath: string, format: ExtractedContent['sourceFormat']): ExtractedContent {
  return {
    text: `[Failed to extract text from ${basename(filePath)}. Install required parser or convert to a text format.]`,
    metadata: { title: basename(filePath), wordCount: 0 },
    sourceFormat: format,
  };
}
