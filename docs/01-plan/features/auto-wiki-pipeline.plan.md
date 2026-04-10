# auto-wiki-pipeline Planning Document

> **Summary**: ingest 한 번으로 raw → compile → wiki 까지 자동 완성되는 One-Action Full Pipeline
>
> **Project**: Stellavault
> **Version**: v1.6.x
> **Author**: PM Agent
> **Date**: 2026-04-06
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 파워 유저가 파일/URL을 넣을 때마다 별도로 `compile` 명령을 실행해야 하며, 바이너리 파일은 제텔카스텐 원칙을 무시하고 literature에 직행함 |
| **Solution** | `ingest` 후 비동기 백그라운드 파이프라인(compile + lint)을 자동 실행하는 `--pipeline` 플래그 + 웹 UI 드래그앤드롭 파일 업로드 추가 |
| **Function/UX Effect** | CLI: 인제스트 완료 즉시 "파이프라인 시작됨" 메시지 + 완료 통보. 웹: 드래그앤드롭 → 진행 바 → wiki 링크. 바이너리 파일도 fleeting에서 시작 |
| **Core Value** | "넣으면 끝" — 입력 하나로 지식이 정제·연결되어 vault에 정착하는 경험 |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 현재 ingest → compile → lint 3단계를 수동 실행해야 해서 파워 유저도 마찰을 느낌 |
| **WHO** | 개인 지식 관리에 진심인 파워 유저 (개발자·연구자·기획자), CLI + 웹 UI 모두 사용 |
| **RISK** | compile이 LLM 호출 시 30초+, 동기 처리하면 UX 파괴; 원본 훼손 가능성 |
| **SUCCESS** | ingest 1회 → 10분 이내 wiki 노트 자동 생성, 원본 raw 보존, 사용자 승인 없이 permanent 미생성 |
| **SCOPE** | Phase 1: CLI `--pipeline` 비동기 파이프라인. Phase 2: 웹 UI 드래그앤드롭 + 진행 상태. Phase 3: auto-link + permanent 후보 추천 |

---

## 1. Overview

### 1.1 Purpose

사용자가 파일 또는 URL을 `ingest`하면 자동으로 compile → lint 파이프라인이 실행되어
별도 명령 없이 wiki 노트가 생성된다. 웹 UI에서는 드래그앤드롭으로 바이너리 파일도
업로드할 수 있다.

### 1.2 Background

**현재 문제**:
- CLI: `ingest` → `compile` → `lint` 3단계 수동 실행 필요
- 웹 UI: URL 인제스트만 가능, 파일 업로드 패널 없음
- 바이너리 파일(PDF 등)이 제텔카스텐 원칙 무시하고 `_literature/` 직행
- 이미 `autopilot-cmd.ts`에 풀 파이프라인 로직이 있으나 인제스트와 연결 안 됨

**PM 결론 (5가지 논의 사항)**:

1. **자동 파이프라인 범위**: compile + lint 자동화. Opt-in `--pipeline` 플래그로 시작.
   LLM 호출은 compile 옵션으로 분리하여 기본값은 규칙 기반 컴파일만 수행.
   → 비용/시간 리스크 제거, 파워 유저가 원할 때만 LLM 켬.

2. **바이너리 파일 자동 승격 문제**: **fleeting에서 시작**이 정답.
   - 제텔카스텐 원칙: 모든 외부 인풋은 fleeting (raw/) → 사용자 검토 → literature 승격
   - PDF가 "이미 구조화됨"은 개발자 편의 판단이지, 사용자 지식 워크플로우 반영 아님
   - 단, 태그에 `#source-pdf` 자동 부여하여 나중에 구분 가능하게 유지
   - `--stage literature` 옵션은 유지 (사용자가 명시하면 존중)

3. **웹 UI 드래그앤드롭**: Phase 2에서 구현.
   파일 → multipart POST `/api/ingest/file` → 서버 측 extractFileContent → ingest 파이프라인.

4. **"알아서 정리"의 수준**: **Level 2** (raw 저장 + compile) 를 기본으로,
   `--lint` 플래그 추가 시 Level 3 (+ lint). Level 4 (permanent 후보 추천)는 Phase 3.
   - Level 1만으로는 사용자 기대치 미달
   - Level 4는 permanent 승격의 의미를 희석시킬 위험

5. **실행 시간 트레이드오프**: **비동기 처리** (즉시 반환 + 백그라운드 실행).
   - CLI: ingest 완료 즉시 프롬프트 반환, 백그라운드 프로세스가 compile 실행 후 완료 파일 생성
   - 웹 UI: SSE(Server-Sent Events) 또는 폴링으로 진행 상태 전달
   - 동기 처리는 30초 블로킹으로 UX 파괴

### 1.3 Related Documents

- 기존 ingest plan: `docs/01-plan/file-ingest-v2.plan.md`
- autopilot-cmd: `packages/cli/src/commands/autopilot-cmd.ts`
- wiki-compiler: `packages/core/src/intelligence/wiki-compiler.ts`

---

## 2. Scope

### 2.1 In Scope

**Phase 1 — CLI Auto-Pipeline (Must)**
- [ ] `stellavault ingest <input> --pipeline` 플래그 추가
- [ ] `--pipeline` 시 ingest 완료 후 자동 compile 실행 (비동기)
- [ ] `--pipeline --lint` 시 compile 후 자동 lint 실행
- [ ] 바이너리 파일(PDF/DOCX 등) fleeting(raw/)에서 시작하도록 기본값 변경
- [ ] 파이프라인 완료 시 `.stellavault-pipeline-{hash}.done` 파일 생성 (완료 추적)
- [ ] CLI 출력: "Saving to raw/... Pipeline started in background. [done file path]"

**Phase 2 — 웹 UI 드래그앤드롭 (Should)**
- [ ] 웹 UI 인제스트 패널에 파일 드래그앤드롭 영역 추가
- [ ] `POST /api/ingest/file` — multipart/form-data 파일 업로드 엔드포인트
- [ ] 업로드 진행 상태 표시 (파일 크기 퍼센트)
- [ ] 인제스트 완료 후 생성된 노트 링크 표시

**Phase 3 — Auto-link + Permanent 후보 추천 (Could)**
- [ ] compile 완료 후 기존 노트와 자동 링크 생성
- [ ] 높은 유사도 노트 군집 감지 → permanent 후보로 사용자에게 제안

### 2.2 Out of Scope

- LLM 기반 AI 요약/재구성 compile (별도 `--ai-compile` 플래그로 분리, 이번 범위 아님)
- permanent 자동 생성 (사용자 명시적 승인 없이 permanent 생성 금지)
- 실시간 협업 / 멀티-유저 파이프라인
- 클라우드 스토리지 직접 연동 (S3, Google Drive 등)
- 모바일 앱 UI

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | `ingest --pipeline` 실행 시 비동기로 compile 자동 실행 | Must | Pending |
| FR-02 | `ingest --pipeline --lint` 실행 시 compile 후 lint 자동 실행 | Must | Pending |
| FR-03 | 바이너리 파일(PDF/DOCX/PPTX/XLSX) 기본 stage를 fleeting으로 변경 | Must | Pending |
| FR-04 | `--stage literature` 명시 시 기존 동작 유지 (override 허용) | Must | Pending |
| FR-05 | 파이프라인 완료 후 완료 파일 생성 (CLI에서 결과 확인 가능) | Must | Pending |
| FR-06 | 웹 UI 파일 드래그앤드롭 영역 추가 | Should | Pending |
| FR-07 | `POST /api/ingest/file` 멀티파트 파일 업로드 API | Should | Pending |
| FR-08 | 웹 UI 파이프라인 진행 상태 표시 (SSE 또는 폴링) | Should | Pending |
| FR-09 | compile 완료 후 기존 노트와 자동 링크 생성 | Could | Pending |
| FR-10 | permanent 후보 노트를 웹 UI에서 추천 표시 | Could | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | ingest CLI 명령 즉시 반환 (< 1초), 백그라운드 파이프라인 10분 이내 | CLI 타이머, 파이프라인 로그 |
| Reliability | 파이프라인 실패 시 raw/ 원본 파일 보존 (유실 금지) | 실패 후 raw/ 파일 존재 확인 |
| Security | 파일 업로드 크기 제한 50MB, MIME 타입 화이트리스트 | 업로드 거부 테스트 |
| Backward Compat | `--pipeline` 없이 기존 `ingest` 동작 100% 유지 | 기존 127 테스트 전부 통과 |
| Observability | 파이프라인 각 단계 로그 파일에 기록 | `.stellavault/pipeline.log` 존재 확인 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] SC1: `stellavault ingest <file> --pipeline` → 1초 내 반환, raw/에 파일 저장, 백그라운드 compile 시작
- [ ] SC2: 파이프라인 완료 후 `_wiki/` 또는 `_literature/`에 노트 생성
- [ ] SC3: `stellavault ingest <pdf> --pipeline` → raw/에 먼저 저장 (fleeting 기본값)
- [ ] SC4: `stellavault ingest <pdf> --pipeline --stage literature` → literature 직행 (override)
- [ ] SC5: 웹 UI에서 파일 드래그앤드롭 → 업로드 진행 → 완료 후 노트 링크 표시 (Phase 2)
- [ ] SC6: 기존 127 테스트 ALL PASS (회귀 없음)
- [ ] SC7: 파이프라인 실패 시 raw/ 원본 파일 유지 (유실 없음)

### 4.2 Quality Criteria

- [ ] 새 기능 단위 테스트 80% 이상 커버리지
- [ ] 바이너리 파일 stage 변경으로 인한 기존 동작 회귀 없음
- [ ] 웹 UI 파일 업로드 XSS/SSRF 취약점 없음

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| compile 실패 시 사용자가 인지 못함 (백그라운드) | High | Medium | `.stellavault/pipeline.log`에 에러 기록 + `stellavault status` 명령으로 확인 |
| 바이너리 기본값 변경(fleeting)으로 기존 스크립트 동작 변경 | Medium | Low | `--stage literature` 옵션 문서화, 변경 사항 CHANGELOG에 명시 (breaking change) |
| 웹 UI 대용량 파일 업로드 서버 부하 | Medium | Low | 50MB 제한, 청크 업로드 또는 스트리밍 처리 |
| 파이프라인 중복 실행 (같은 파일 다시 ingest) | Low | Medium | 파일명 + 타임스탬프 slug로 중복 방지 (기존 로직 활용) |
| LLM 비용 우려로 compile 실행 기피 | Low | High | 기본 compile은 LLM 없는 규칙 기반, LLM은 명시적 `--ai-compile` 플래그만 |

---

## 6. Impact Analysis

### 6.1 Changed Resources

| Resource | Type | Change Description |
|----------|------|--------------------|
| `ingest-cmd.ts` | CLI Command | `--pipeline` 플래그 추가, 바이너리 기본 stage 변경 |
| `ingest-pipeline.ts` | Core Logic | `ingest()` 함수 시그니처에 pipeline 옵션 추가 |
| Web UI ingest panel | Frontend Component | 드래그앤드롭 파일 업로드 영역 추가 |
| `/api/ingest` | API Route | 파일 업로드 멀티파트 지원 추가 |

### 6.2 Current Consumers

| Resource | Operation | Code Path | Impact |
|----------|-----------|-----------|--------|
| `ingest-cmd.ts` | EXEC | `cli/src/main.ts` → ingestCommand | Breaking: 바이너리 기본 stage 변경 |
| `ingest-pipeline.ts` `ingest()` | CALL | `ingest-cmd.ts`, 웹 API | Needs verification |
| 웹 ingest panel | RENDER | `serve-cmd.ts` 내 정적 HTML | 추가만, 기존 동작 유지 |

### 6.3 Verification

- [ ] 기존 텍스트/URL ingest 동작 유지 확인
- [ ] 바이너리 파일 stage 변경 영향 범위 확인 (테스트 + 문서)
- [ ] 웹 UI URL 인제스트 기존 기능 회귀 없음

---

## 7. Architecture Considerations

### 7.1 Project Level

**Dynamic** — 기존 Stellavault CLI/Core 모노레포 구조 유지. 새 모듈 최소화.

### 7.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 파이프라인 비동기 처리 | Node.js child_process / Promise 체인 / 별도 daemon | Promise 체인 + detached spawn | CLI에서 `--pipeline`은 detached child process로 실행, 웹은 Promise 체인 |
| 진행 상태 전달 (웹) | SSE / WebSocket / 폴링 | 폴링 (2초 간격) | 기존 serve-cmd 구조에서 SSE 추가 복잡도 최소화. 추후 SSE로 업그레이드 가능 |
| 파일 업로드 API | multipart/form-data / base64 JSON | multipart/form-data | 표준 방식, 대용량 파일 처리 효율 |
| 바이너리 stage 기본값 | literature 유지 / fleeting 변경 | fleeting | 제텔카스텐 원칙 준수, 사용자 주권 보장 |

### 7.3 Pipeline Flow

```
stellavault ingest <input> --pipeline [--lint] [--stage X]
         │
         ▼
  [ingest-cmd.ts]
  1. Input 감지 (URL / 바이너리 / 텍스트)
  2. stage 결정: 바이너리 → fleeting (기본), --stage 명시 시 override
  3. ingest() 호출 → raw/ 저장
  4. 즉시 반환 "Saved to raw/. Pipeline starting..."
  5. detached child: compile-cmd.ts [--file <saved-path>]
         │
         ▼ (백그라운드)
  [compile-cmd.ts]
  6. raw/ 스캔 → wiki 변환
  7. --lint 플래그 시 → lint-cmd.ts 실행
  8. 완료 → .stellavault/pipeline.log 기록
```

---

## 8. MoSCoW 우선순위 요약

| Priority | Feature |
|----------|---------|
| **Must** | `--pipeline` 플래그, 비동기 compile, 바이너리 기본 stage → fleeting |
| **Should** | 웹 UI 드래그앤드롭, `/api/ingest/file` API, 진행 상태 표시 |
| **Could** | auto-link, permanent 후보 추천 |
| **Won't (now)** | LLM AI compile 자동화, permanent 자동 생성, 클라우드 스토리지 연동 |

---

## 9. Next Steps

1. [ ] 이 Plan 문서 CTO(팀 리드) 승인
2. [ ] `/pdca design auto-wiki-pipeline` — 상세 설계 (API 스펙, 컴포넌트 구조)
3. [ ] Phase 1 (CLI `--pipeline`) 구현 → 기존 테스트 통과 확인
4. [ ] Phase 2 (웹 UI 드래그앤드롭) 구현
5. [ ] smoke test에 pipeline E2E 케이스 추가

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-04-06 | Initial draft — PM discussion 기반 | PM Agent |
