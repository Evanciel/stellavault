# Design: auto-wiki-pipeline

## Part A: 자동 파이프라인

### core 변경: `ingest-pipeline.ts`

```typescript
// ingest() 끝에 자동 compile 추가
export function ingest(vaultPath, input): IngestResult {
  // ... 기존 저장 로직 ...
  
  // 자동 compile (동기 — rule-based라 <100ms)
  try {
    const wikiPath = resolve(vaultPath, '_wiki');
    compileWiki(resolve(vaultPath, 'raw'), wikiPath);
  } catch { /* compile 실패해도 ingest 성공 */ }
  
  return result;
}
```

### CLI 변경: `ingest-cmd.ts`
- 바이너리 파일 `stage` 기본값: `fleeting` (literature → fleeting)
- ingest 후 "Compiled to wiki" 메시지 추가

### API 변경: `server.ts`
- POST /api/ingest 응답 후 compile 실행
- 바이너리 파일 `stage` 기본값: `fleeting`

## Part B: 웹 파일 업로드

### 새 API: `POST /api/ingest/file`

```typescript
// multer middleware (50MB limit, memory storage)
app.post('/api/ingest/file', upload.single('file'), async (req, res) => {
  const file = req.file;  // { originalname, mimetype, buffer, size }
  
  // MIME 화이트리스트
  const allowed = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // docx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // xlsx
    'application/vnd.ms-excel',           // xls
    'text/plain', 'text/markdown',
  ]);
  
  // 1. 임시 파일 저장 (extractFileContent가 파일 경로 필요)
  // 2. extractFileContent() 호출
  // 3. ingest() 호출 (fleeting stage)
  // 4. 임시 파일 삭제
  // 5. 응답: { savedTo, title, wordCount, stage }
});
```

### UI: `IngestPanel.tsx` 드래그앤드롭

```
┌──────────────────────────────┐
│  + Add Knowledge             │
│                              │
│  ┌─────────────────────────┐ │
│  │  📄 Drop files here     │ │
│  │  or click to browse     │ │
│  │                         │ │
│  │  PDF, DOCX, PPTX, XLSX │ │
│  └─────────────────────────┘ │
│                              │
│  ─── or enter text/URL ───  │
│  ┌─────────────────────────┐ │
│  │ URL or text...          │ │
│  └─────────────────────────┘ │
│                              │
│  Tags: [                  ]  │
│  [    Ingest    ]            │
│                              │
│  Recent: file1.pdf ✓         │
└──────────────────────────────┘
```

구현:
- `<div onDragOver onDrop>` — 드래그앤드롭 존
- `<input type="file" accept=".pdf,.docx,.pptx,.xlsx,.xls,.md,.txt">` — hidden, 클릭 시 열림
- 파일 선택 → `FormData` → `fetch('/api/ingest/file')` POST
- 진행 상태: idle → uploading → processing → done/error

## Part C: 모바일/PWA

### PWA 등록 (`main.tsx`)
```typescript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
}
```

### `index.html` 추가
```html
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#6366f1">
<link rel="manifest" href="/manifest.json">
```

### IngestPanel 반응형
```css
/* 모바일 (< 640px) */
@media (max-width: 640px) {
  .ingest-panel {
    width: 100vw;
    right: 0;
    bottom: 0;
    border-radius: 16px 16px 0 0;
    max-height: 80vh;
  }
  .ingest-btn {
    bottom: 16px;
    right: 16px;
    width: 56px;
    height: 56px;  /* 터치 영역 확대 */
  }
}
```

### 드래그앤드롭 존 모바일 대응
- 모바일: 드래그 불가 → "Tap to select file" 텍스트
- `<input type="file">` capture 속성으로 카메라도 가능
- 터치 타겟 최소 44px
