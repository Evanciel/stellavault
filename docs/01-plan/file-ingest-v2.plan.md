# Plan: file-ingest-v2 — Binary File Ingest Support

## Goal
`stellavault ingest <file>` 명령어에서 PDF, DOCX, PPTX, XLSX 바이너리 파일의 텍스트를 정상 추출하여 Obsidian 노트로 저장.

## Current Problem
- `ingest-cmd.ts:91` — `readFileSync(input, 'utf-8')`로 모든 파일을 읽어서 바이너리 파일이 깨짐
- PDF, Office 파일은 바이너리 포맷이므로 전용 파서 필요

## Scope

### In Scope
| 포맷 | 파서 | 전략 |
|------|------|------|
| PDF | `unpdf` | 네이티브 ESM, UnJS 생태계, 가볍고 현대적 |
| DOCX | `mammoth` | 2.2M DL, raw text 추출, CJS→ESM 호환 |
| PPTX | `officeparser` | 유일한 양질 옵션, 멀티포맷 지원 |
| XLSX/XLS | `xlsx` (SheetJS) | 업계 표준, CSV 변환으로 텍스트 추출 |

### Out of Scope
- 레거시 DOC/PPT (OLE2 바이너리) — 순수 JS 파서 없음
- 이미지 내 텍스트 OCR
- 암호화된 파일

## Architecture

### 신규 모듈: `packages/core/src/intelligence/file-extractors.ts`

```
extractFileContent(filePath: string): Promise<ExtractedContent>
  ├── .pdf  → unpdf.extractText(buffer)
  ├── .docx → mammoth.extractRawText({buffer})
  ├── .pptx → officeparser.parseOffice(buffer)
  ├── .xlsx/.xls → xlsx.read(buffer) → sheet_to_csv
  └── 기타  → readFileSync(path, 'utf-8') (기존 동작)
```

```typescript
interface ExtractedContent {
  text: string;        // 추출된 텍스트
  metadata: {
    title?: string;    // PDF title, DOCX title 등
    author?: string;
    pageCount?: number;
    wordCount: number;
  };
  sourceFormat: string; // 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'text'
}
```

### 수정 대상 파일

1. **`packages/core/src/intelligence/file-extractors.ts`** (신규)
   - 파일 확장자별 파서 디스패치
   - 추출 결과 정규화 (ExtractedContent)

2. **`packages/cli/src/commands/ingest-cmd.ts`** (수정)
   - 파일 분기에서 `readFileSync` → `extractFileContent()` 호출
   - 바이너리 파일은 자동으로 `literature` 스테이지

3. **`packages/core/src/intelligence/ingest-pipeline.ts`** (수정)
   - `IngestInput.type`에 'pdf' | 'docx' | 'pptx' | 'xlsx' 추가
   - `extractAutoTags`에 포맷별 태그 추가
   - `extractTitleFromContent`에서 metadata.title 우선 사용

4. **`packages/core/package.json`** (수정)
   - dependencies: unpdf, mammoth, officeparser, xlsx 추가

## Success Criteria

- [ ] SC1: PDF 파일 인제스트 → 텍스트 정상 추출, 노트 생성
- [ ] SC2: DOCX 파일 인제스트 → 텍스트 정상 추출, 노트 생성
- [ ] SC3: PPTX 파일 인제스트 → 슬라이드 텍스트 추출, 노트 생성
- [ ] SC4: XLSX 파일 인제스트 → CSV 형태 텍스트, 노트 생성
- [ ] SC5: 지원하지 않는 확장자 → 기존 동작 유지 (utf-8 읽기)
- [ ] SC6: 빌드 성공 + 127 기존 테스트 ALL PASS
- [ ] SC7: 각 포맷별 인제스트 후 word count > 50

## Implementation Order
1. 의존성 설치 (unpdf, mammoth, officeparser, xlsx)
2. file-extractors.ts 작성
3. ingest-cmd.ts 수정 (CLI 파일 분기)
4. ingest-pipeline.ts 수정 (타입 + 태그)
5. 빌드 + 테스트
6. 실제 파일로 E2E 검증

## Risk
- officeparser CJS→ESM 호환 문제 가능 → dynamic import로 해결
- xlsx ESM 호환 문제 → `import * as XLSX from 'xlsx'` 패턴
- 대용량 파일 (100MB+) 메모리 → 일단 무시, 필요시 스트리밍
