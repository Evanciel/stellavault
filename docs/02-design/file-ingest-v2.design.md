# Design: file-ingest-v2 — Binary File Text Extraction

## Module: `packages/core/src/intelligence/file-extractors.ts`

### Public API

```typescript
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

/**
 * 파일 경로에서 텍스트 추출. 확장자 기반 파서 디스패치.
 * 지원: .pdf, .docx, .pptx, .xlsx, .xls
 * 미지원 확장자: utf-8 텍스트로 읽기 (기존 동작)
 */
export async function extractFileContent(filePath: string): Promise<ExtractedContent>;
```

### Internal Dispatchers

```typescript
// 각 파서는 lazy import (사용 시점에만 로드)
async function extractPdf(buffer: Buffer): Promise<ExtractedContent>;
async function extractDocx(buffer: Buffer): Promise<ExtractedContent>;
async function extractPptx(buffer: Buffer): Promise<ExtractedContent>;
async function extractXlsx(buffer: Buffer): Promise<ExtractedContent>;
```

### Parser Details

| Format | Package | Import | Key API |
|--------|---------|--------|---------|
| PDF | unpdf | `import { extractText } from 'unpdf'` | `extractText(buffer)` → `{ text, totalPages }` |
| DOCX | mammoth | `import mammoth from 'mammoth'` | `mammoth.extractRawText({buffer})` → `{ value }` |
| PPTX | officeparser | `import officeparser from 'officeparser'` | `officeparser.parseOffice(buffer)` → text |
| XLSX | xlsx | `import * as XLSX from 'xlsx'` | `XLSX.read(buffer)` → `sheet_to_csv()` |

### Error Handling

- 파서 로드 실패 → fallback to utf-8 read + warning 로그
- 파서 실행 실패 → 빈 텍스트 + 에러 메시지를 노트에 포함
- 파일 읽기 실패 → throw (기존 동작)

## CLI 수정: `packages/cli/src/commands/ingest-cmd.ts`

### Before (현재)
```typescript
} else if (existsSync(input)) {
  const ext = extname(input).toLowerCase();
  const fileContent = readFileSync(input, 'utf-8');  // 문제!
  ingestInput = {
    type: ext === '.pdf' ? 'pdf-text' : 'file',
    content: fileContent,
    ...
  };
}
```

### After (수정)
```typescript
} else if (existsSync(input)) {
  const ext = extname(input).toLowerCase();
  const binaryExts = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.xls']);

  if (binaryExts.has(ext)) {
    // 바이너리 파일: 전용 파서로 텍스트 추출
    const { extractFileContent } = await import('@stellavault/core/intelligence/file-extractors');
    const extracted = await extractFileContent(resolve(input));
    ingestInput = {
      type: extracted.sourceFormat as any,
      content: extracted.text,
      tags: [...tags, extracted.sourceFormat],
      stage: stage === 'fleeting' ? 'literature' : stage,  // 바이너리 파일은 자동 승격
      title: options.title ?? extracted.metadata.title,
      source: input,
    };
  } else {
    // 텍스트 파일: 기존 동작
    const fileContent = readFileSync(input, 'utf-8');
    ingestInput = {
      type: 'file',
      content: fileContent,
      tags,
      stage,
      title: options.title,
      source: input,
    };
  }
}
```

## Pipeline 수정: `packages/core/src/intelligence/ingest-pipeline.ts`

### IngestInput.type 확장
```typescript
export interface IngestInput {
  type: 'url' | 'text' | 'file' | 'youtube' | 'pdf-text' | 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'xls';
  // ...
}
```

### extractAutoTags 확장
```typescript
if (type === 'pdf') tags.add('pdf');
if (type === 'docx') tags.add('document');
if (type === 'pptx') tags.add('presentation');
if (type === 'xlsx' || type === 'xls') tags.add('spreadsheet');
```

## Core package.json 수정

### exports 추가
```json
"./intelligence/file-extractors": {
  "import": "./dist/intelligence/file-extractors.js",
  "types": "./dist/intelligence/file-extractors.d.ts"
}
```

### dependencies 추가
```json
"unpdf": "^1.4.0",
"mammoth": "^1.12.0",
"officeparser": "^6.0.0",
"xlsx": "^0.18.5"
```
