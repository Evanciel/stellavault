// Design Ref: §file-ingest-v2 — Binary file text extraction dispatchers
// Plan SC: SC1-SC5 (format-specific extraction + fallback)

import { readFileSync } from 'node:fs';
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
export async function extractFileContent(filePath: string): Promise<ExtractedContent> {
  const ext = extname(filePath).toLowerCase();
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
    const text = await officeparser.default.parseOffice(buffer) as string;
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
    const text = workbook.SheetNames
      .map((name: string) => {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
        return `## ${name}\n\n${csv}`;
      })
      .join('\n\n');
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
