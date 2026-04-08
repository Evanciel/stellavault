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
      const headers = rows[0].map((h: any) => String(h ?? ''));
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

function fallback(filePath: string, format: ExtractedContent['sourceFormat']): ExtractedContent {
  return {
    text: `[Failed to extract text from ${basename(filePath)}. Install required parser or convert to a text format.]`,
    metadata: { title: basename(filePath), wordCount: 0 },
    sourceFormat: format,
  };
}
