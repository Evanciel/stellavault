# Plan: auto-wiki-pipeline — 자동 파이프라인 + 웹 드래그앤드롭 + 모바일

## Goal
파일을 넣으면(CLI/웹/모바일) raw→compile→wiki 자동 처리. "넣으면 끝" UX.

## Current State
- CLI ingest: 파일 저장만 (compile 별도 실행)
- Web ingest: URL/텍스트만 (파일 업로드 없음)
- PWA: manifest+SW 있지만 미등록
- 모바일: 반응형 아님 (고정 레이아웃)
- 배경 작업: 없음 (동기 처리)

## Scope (3 Parts)

### Part A: 자동 파이프라인 (CLI + API 공통)
ingest 후 자동으로 compile 실행 → wiki 생성

| 변경 | 파일 | 설명 |
|------|------|------|
| core 함수 | `ingest-pipeline.ts` | `ingest()` 반환 후 `compileWiki()` 자동 호출 |
| CLI | `ingest-cmd.ts` | ingest 후 compile 자동 실행 + 결과 표시 |
| API | `server.ts` | POST /api/ingest 응답 후 비동기 compile |
| 바이너리 기본 stage | `ingest-cmd.ts` + `server.ts` | literature → fleeting 변경 |

### Part B: 웹 파일 드래그앤드롭
브라우저에서 파일 드래그 → 자동 인제스트

| 변경 | 파일 | 설명 |
|------|------|------|
| API endpoint | `server.ts` | POST /api/ingest/file (multipart) |
| UI 컴포넌트 | `IngestPanel.tsx` | 드래그앤드롭 존 + file input |
| 파일 크기 제한 | server.ts | 50MB max |
| MIME 화이트리스트 | server.ts | pdf,docx,pptx,xlsx,xls,md,txt |

### Part C: 모바일/PWA
모바일에서도 사용 가능한 반응형 + PWA 설치

| 변경 | 파일 | 설명 |
|------|------|------|
| PWA 등록 | `main.tsx` | SW 등록 + manifest link |
| IngestPanel 반응형 | `IngestPanel.tsx` | 모바일: 전체 너비, 터치 영역 확대 |
| Layout 반응형 | `Layout.tsx` | 작은 화면 대응 |
| viewport | `index.html` | meta viewport 태그 |

## Architecture

### 자동 파이프라인 흐름
```
입력 (CLI/Web/Mobile)
  → ingest() → raw/ 저장
  → 즉시 반환 ("저장됨!")
  → 백그라운드: compileWiki(raw/, wiki/)
  → wiki 노트 자동 생성
```

### 웹 파일 업로드 흐름
```
브라우저 파일 드래그/선택
  → POST /api/ingest/file (multipart/form-data)
  → multer로 임시 저장
  → extractFileContent() 텍스트 추출
  → ingest() → raw/ 저장
  → compile 자동 실행
  → 응답: { savedTo, title, wordCount }
```

### 의존성
- `multer` — Express multipart 파일 업로드 (npm 10M+ DL, Trusted)

## Success Criteria

- [ ] SC1: CLI `stellavault ingest file.pdf` → raw/ 저장 + 자동 compile → wiki 생성
- [ ] SC2: 웹 UI에서 PDF 드래그앤드롭 → 인제스트 + compile 완료
- [ ] SC3: 모바일 화면(375px)에서 IngestPanel 정상 표시 + 파일 선택 가능
- [ ] SC4: PWA 설치 가능 (manifest + SW 정상 등록)
- [ ] SC5: 바이너리 파일 기본 stage = fleeting
- [ ] SC6: 빌드 + 127 기존 테스트 ALL PASS
- [ ] SC7: 50MB 초과 파일 → 에러 메시지

## Implementation Order
1. Part A: 자동 파이프라인 (core 변경)
2. Part B: 웹 파일 업로드 (API + UI)
3. Part C: 모바일/PWA
4. 빌드 + 테스트 + E2E 검증

## Risk
- multer + ESM 호환 → dynamic import로 해결
- compile이 오래 걸리면 → 현재 rule-based라 <100ms, 문제 없음
- 대용량 파일 메모리 → 50MB 제한으로 방어
