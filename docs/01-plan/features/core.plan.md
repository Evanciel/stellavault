# Phase 4a: Open Source Launch Preparation

> **Summary**: ekh 프로젝트의 오픈소스 공개 준비 — 바이럴 기능(그래프 스크린샷, 별자리 고도화) + 문서/레포 정비
>
> **Project**: evan-knowledge-hub
> **Version**: 0.4.0-alpha
> **Author**: Evan (KHS)
> **Date**: 2026-03-31
> **Status**: Draft
> **PRD Reference**: `docs/00-pm/core.prd.md` (Phase 4+ Expansion PRD)

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | Phase 1-3의 핵심 기능(92 tests, 10 MCP tools, 3D 그래프)이 완성되었으나 개인용으로만 사용 중. 공개 시 "와" 효과를 줄 바이럴 자산과 개발자 온보딩 문서가 없음 |
| **Solution** | 3D 그래프 스크린샷/GIF 내보내기 + 별자리 뷰 LOD 고도화로 시각적 차별화 확보. README, 아키텍처 다이어그램, 설치 가이드 정비로 개발자 진입 장벽 제거 |
| **Function/UX Effect** | 사용자가 자신의 "지식 우주"를 이미지/GIF로 캡처하여 SNS 공유 가능. 별자리 뷰에서 줌 레벨에 따라 추상화↔세부 자연 전환 |
| **Core Value** | "Show your knowledge universe" — 시각적 공유를 통한 자연적 바이럴 성장 엔진 |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 완성된 프로젝트를 세상에 공개하기 위한 "첫인상" 준비. 시각적 임팩트가 오픈소스 초기 관심의 핵심 |
| **WHO** | Claude Code + Obsidian 사용 개발자 (Beachhead), 테크 블로거/크리에이터 (바이럴 확산) |
| **RISK** | 3D 렌더링 → 이미지 변환 품질/성능 이슈; 별자리 LOD 전환 시 UX 끊김 |
| **SUCCESS** | 스크린샷 PNG 2048x2048 < 2초; 별자리 줌 3단계 부드러운 전환; README에서 설치→첫 검색 5분 이내 |
| **SCOPE** | Phase 4a만 (4주). npm publish 미포함. GitHub 레포 공개 준비까지 |

---

## 1. Overview

### 1.1 Purpose

evan-knowledge-hub(ekh)를 오픈소스로 공개하기 위한 준비 단계. 두 가지 축으로 진행:

1. **바이럴 기능**: 3D 지식 그래프를 이미지/GIF로 내보내기 + 별자리 뷰 고도화 → SNS 공유 시 "와" 효과
2. **개발자 온보딩**: README, 아키텍처 다이어그램, 설치 가이드 → GitHub 방문자가 5분 내에 사용 시작

### 1.2 Background

- Phase 1-3 완성: 92 tests ALL PASS, 10 MCP tools, 3D 뉴럴 그래프, Knowledge Pack
- PRD 분석 결과 "바이럴 엔진"이 오픈소스 성장의 핵심 전략 축으로 확인
- 경쟁사(283개 KM MCP 서버) 중 3D 시각화를 제공하는 도구는 없음 → 시각적 차별화 우위
- CLI 이름 "ekh"는 임시. 공개 후 리브랜딩 시 변경 예정

### 1.3 Related Documents

- PRD: `docs/00-pm/core.prd.md`
- Phase 1 Plan: `docs/01-plan/features/evan-knowledge-hub.plan.md`
- Phase 2 Design: `docs/02-design/features/evan-knowledge-hub-phase2.design.md`
- Phase 2.5 Design: `docs/02-design/features/evan-knowledge-hub-phase2.5.design.md`

---

## 2. Scope

### 2.1 In Scope

- [ ] F16: 3D 그래프 스크린샷 내보내기 (PNG, WebM GIF)
- [ ] F16: 그래프 iframe 임베드 코드 생성
- [ ] F07+: 별자리 뷰 LOD (줌 레벨별 별자리↔노트 전환)
- [ ] F07+: 별자리 레이블 표시 (클러스터명)
- [ ] README.md 전면 재작성 (아키텍처 다이어그램, 스크린샷, 설치 가이드)
- [ ] CONTRIBUTING.md 작성
- [ ] LICENSE 파일 추가 (MIT)
- [ ] .env.example 생성

### 2.2 Out of Scope

- FR-04 iframe 임베드 코드 생성 — Phase 4b로 이동
- npm publish (@ekh/core, @ekh/cli) — 아직 공개 안 함
- CLI 이름 리브랜딩 (ekh → 새 이름)
- FSRS 감쇠 모델 (Phase 4b)
- 지식 갭 탐지기 (Phase 4b)
- 진화 타임라인 (Phase 4c)
- 코드-지식 링커 (Phase 4c)
- Product Hunt / Hacker News 런치 (공개 후 별도 진행)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 3D 그래프 현재 뷰를 PNG 2048x2048로 내보내기 (Three.js canvas → toDataURL) | High | Pending |
| FR-02 | 3D 그래프 회전 애니메이션을 WebM/GIF로 녹화 (MediaRecorder API) | High | Pending |
| FR-03 | 내보내기 버튼 UI (ExportPanel 컴포넌트) + 설정(해상도, 배경색, 워터마크 토글) | High | Pending |
| FR-04 | iframe 임베드 코드 생성 (현재 그래프 상태를 쿼리 파라미터로 직렬화) | Medium | Pending |
| FR-05 | 별자리 뷰 LOD: 줌아웃 시 클러스터를 별자리(constellation)로 추상화, 줌인 시 개별 노트 노드 표시 | High | Pending |
| FR-06 | 별자리 레이블: 각 클러스터의 이름을 별자리 위에 Billboard 텍스트로 표시 | Medium | Pending |
| FR-07 | 줌 레벨 3단계 전환 애니메이션 (easing, 부드러운 노드 합체/분리) | Medium | Pending |
| FR-08 | README.md: 아키텍처 다이어그램 (Mermaid), 기능 스크린샷, Quick Start (5분 설치) | High | Pending |
| FR-09 | CONTRIBUTING.md: 개발 환경 설정, PR 가이드라인, 코드 컨벤션 | Medium | Pending |
| FR-10 | .env.example: 필요한 환경변수 목록과 설명 | Low | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | PNG 스크린샷 생성 < 2초 (2048x2048) | 타이머 + 자동 테스트 |
| Performance | WebM 녹화 시 60fps 유지 (5초 클립) | 프레임 카운터 |
| Performance | 별자리 LOD 전환 < 300ms (10K 노드 기준) | 애니메이션 프로파일링 |
| UX | 줌 전환 시 프레임 드롭 없음 (RequestAnimationFrame) | 시각적 검증 |
| 호환성 | Chrome 120+, Firefox 120+, Safari 17+ | 크로스 브라우저 테스트 |
| 파일 크기 | PNG 출력 < 5MB, WebM 5초 클립 < 10MB | 파일 크기 검증 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] SC-01: 3D 그래프 스크린샷(PNG)이 현재 카메라 뷰를 정확히 캡처
- [ ] SC-02: WebM 녹화가 360도 회전 애니메이션을 5초간 기록
- [ ] SC-03: 별자리 뷰에서 줌 3단계(우주→별자리→노트) 전환이 부드럽게 작동
- [ ] SC-04: README Quick Start로 새 사용자가 5분 내에 ekh index + ekh search 실행 가능
- [ ] SC-05: 모든 기존 92 tests 통과 유지 (regression 없음)
- [ ] SC-06: Phase 4a 신규 기능 테스트 최소 10개 추가

### 4.2 Quality Criteria

- [ ] 기존 테스트 92개 ALL PASS (zero regression)
- [ ] 신규 테스트 10+ 추가 (총 102+)
- [ ] Zero lint errors
- [ ] TypeScript strict 모드 유지

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Three.js canvas → PNG 변환 시 WebGL 컨텍스트 손실 | High | Medium | `preserveDrawingBuffer: true` 설정 + fallback으로 `readPixels` 직접 사용 |
| WebM 녹화 시 브라우저 호환성 (Safari 미지원) | Medium | High | Safari는 PNG 시퀀스 fallback 제공. 메인 타겟은 Chrome/Firefox |
| 별자리 LOD 전환 시 노드 위치 점프 (불연속적 UX) | Medium | Medium | lerp 기반 트위닝 (300ms easing). 노드 합체/분리 애니메이션 |
| README 스크린샷이 실제 기능과 불일치 | Low | Low | 자동 스크린샷 생성 스크립트 or 최종 검증 체크리스트 |
| 공개 후 이름 변경 필요 시 breaking change | Medium | High | alias 지원 계획. 지금은 ekh로 유지 |

---

## 6. Impact Analysis

### 6.1 Changed Resources

| Resource | Type | Change Description |
|----------|------|--------------------|
| `packages/graph/src/App.tsx` | Component | ExportPanel 컴포넌트 추가, 별자리 LOD 로직 확장 |
| `packages/graph/src/components/ConstellationView.tsx` | Component | LOD 로직 추가 (줌 레벨 감지 → 추상화 전환) |
| `packages/graph/src/components/` | Directory | ExportPanel.tsx, ConstellationLabel.tsx 신규 파일 |
| `packages/graph/src/hooks/` | Directory | useExport.ts, useConstellationLOD.ts 신규 훅 |
| `packages/graph/src/stores/graph-store.ts` | Store | exportState, constellationLODLevel 상태 추가 |
| `README.md` | Docs | 전면 재작성 |

### 6.2 Current Consumers

| Resource | Operation | Code Path | Impact |
|----------|-----------|-----------|--------|
| ConstellationView.tsx | RENDER | App.tsx → 별자리 모드 토글 | Needs verification — LOD 로직 추가 |
| graph-store.ts | READ/WRITE | 모든 그래프 컴포넌트 | Needs verification — 새 상태 추가 |
| App.tsx | RENDER | graph entry point | Needs verification — ExportPanel 통합 |

### 6.3 Verification

- [ ] 기존 ConstellationView 기능 (MST, 줌, 패닝) 정상 동작 확인
- [ ] 기존 그래프 모드 (semantic/folder) 전환 정상 동작 확인
- [ ] graph-store 신규 상태가 기존 상태와 충돌 없음 확인
- [ ] 기존 13개 그래프 관련 테스트 통과 확인

---

## 7. Architecture Considerations

### 7.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| **Starter** | Simple structure | Static sites | ☐ |
| **Dynamic** | Feature-based modules, BaaS | Web apps | ☒ |
| **Enterprise** | Strict layer separation, DI | High-traffic | ☐ |

### 7.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 스크린샷 캡처 | canvas.toDataURL / readPixels / html2canvas | canvas.toDataURL | R3F canvas 직접 접근. 가장 빠르고 정확 |
| 녹화 | MediaRecorder / CCapture.js / manual frames | MediaRecorder | 브라우저 네이티브, 추가 의존성 없음 |
| GIF 변환 | 서버 사이드 / 클라이언트 ffmpeg.wasm / WebM만 지원 | WebM only | GIF는 파일 크기 과다. WebM이 품질/크기 우수 |
| LOD 전환 | 카메라 거리 기반 / 줌 레벨 상태 / LOD 오브젝트 | 카메라 거리 기반 | OrbitControls의 distance를 실시간 감지. 자연스러운 연속 전환 |
| 별자리 레이블 | HTML overlay / Billboard sprite / drei Text | drei Billboard + Text | 3D 공간에서 항상 카메라를 향하는 텍스트. drei에 이미 포함 |
| 상태 관리 | graph-store 확장 / 별도 store | graph-store 확장 | 기존 Zustand store에 슬라이스 추가. 일관성 유지 |

### 7.3 Clean Architecture Approach

```
packages/graph/ (Phase 4a 확장)
├── src/
│   ├── components/
│   │   ├── ExportPanel.tsx         [NEW] 스크린샷/녹화 UI
│   │   ├── ConstellationView.tsx   [MOD] LOD 로직 추가
│   │   ├── ConstellationLabel.tsx  [NEW] 별자리 이름 Billboard
│   │   └── ... (기존 유지)
│   ├── hooks/
│   │   ├── useExport.ts            [NEW] 캡처/녹화 로직
│   │   ├── useConstellationLOD.ts  [NEW] 줌 거리 → LOD 레벨
│   │   └── ... (기존 유지)
│   ├── stores/
│   │   └── graph-store.ts          [MOD] export/LOD 상태 추가
│   └── lib/
│       └── export-utils.ts         [NEW] PNG/WebM 변환 유틸

프로젝트 루트 (문서)
├── README.md                       [REWRITE]
├── CONTRIBUTING.md                  [NEW]
├── LICENSE                          [NEW]
└── .env.example                     [NEW]
```

---

## 8. Convention Prerequisites

### 8.1 Existing Project Conventions

- [x] `CLAUDE.md` has coding conventions section
- [x] TypeScript strict mode (`tsconfig.json`)
- [x] ESM modules (`"type": "module"`)
- [x] kebab-case 파일명, PascalCase 컴포넌트
- [x] Vitest for testing
- [ ] `.env.example` — 미존재 (Phase 4a에서 생성)

### 8.2 Conventions to Verify

| Category | Current State | To Define | Priority |
|----------|---------------|-----------|:--------:|
| **Naming** | kebab-case.ts 일관 | 유지 | ✅ |
| **Folder structure** | monorepo 4 packages | 유지 | ✅ |
| **Import order** | node: → external → internal | 유지 | ✅ |
| **Design Ref comments** | // Design Ref: SS{section} | Phase 4a에서도 적용 | High |
| **Component pattern** | 함수형 + hooks | ExportPanel, LOD에 적용 | High |

### 8.3 Environment Variables Needed

| Variable | Purpose | Scope | To Be Created |
|----------|---------|-------|:-------------:|
| `OBSIDIAN_PATH` | Obsidian vault 경로 | CLI | ☐ (기존, .env.example에 문서화) |
| `EKH_DB_PATH` | SQLite DB 경로 (선택) | CLI | ☐ (.ekh.json에서 관리) |

---

## 9. Implementation Order

### 9.1 Session Plan

| Session | 기능 | 파일 | 예상 작업량 |
|---------|------|------|-----------|
| **Session 1** | 스크린샷 내보내기 (PNG) | useExport.ts, ExportPanel.tsx, export-utils.ts | ~200 lines |
| **Session 2** | WebM 녹화 + 내보내기 UI 완성 | useExport.ts 확장, ExportPanel.tsx 확장 | ~150 lines |
| **Session 3** | 별자리 LOD + 레이블 | useConstellationLOD.ts, ConstellationView.tsx, ConstellationLabel.tsx | ~250 lines |
| **Session 4** | 테스트 + README/문서 정비 | 테스트 파일들, README.md, CONTRIBUTING.md, LICENSE, .env.example | ~300 lines |

### 9.2 Dependencies

```
Session 1 (스크린샷) → Session 2 (녹화) → Session 4 (테스트/문서)
                                              ↑
Session 3 (별자리 LOD) ──────────────────────────┘
```

Session 1 & 3은 독립적으로 병렬 진행 가능.

---

## 10. Next Steps

1. [ ] Design 문서 작성 (`/pdca design core`)
2. [ ] Session 1-4 순차 구현
3. [ ] Gap 분석 (`/pdca analyze core`)
4. [ ] 완료 보고서 (`/pdca report core`)
5. [ ] Phase 4b Plan 작성 (지식 인텔리전스)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-31 | Initial draft — Phase 4a scope (공개 준비 + 바이럴) | Evan (KHS) |
