# F09: FSRS Knowledge Decay Model — Planning Document

> **Summary**: 노트별 기억 강도를 FSRS-6 알고리즘으로 추적하여, 잊어가는 지식을 리마인드하고 3D 그래프에서 감쇠를 시각화
>
> **Project**: evan-knowledge-hub
> **Version**: 0.4.1
> **Author**: Evan (KHS)
> **Date**: 2026-03-31
> **Status**: Draft
> **PRD Reference**: `docs/00-pm/core.prd.md` (F09, G6, US-5.1, TS-7)

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 1,200+ 노트가 쌓이지만, 어떤 노트를 잊어가는지 모름. 같은 실수 반복, 중요한 인사이트 방치 |
| **Solution** | FSRS-6 기반 기억 강도(stability/difficulty) 계산. 노트 접근/MCP 쿼리 시 리셋. 감쇠 임계값 이하 노트 리마인드 |
| **Function/UX Effect** | 3D 그래프에서 감쇠 노드가 서서히 흐려짐. CLI `ekh decay`로 리마인드 목록. MCP `get-decay-status`로 AI가 자동 추천 |
| **Core Value** | "잊어가는 것을 알려주는 살아있는 지식" — Vestige(에이전트 메모리)와 다른, 개인 지식 전체의 감쇠 추적 |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 지식이 쌓이기만 하고 관리 안 됨. 6개월 전 인사이트를 잊고 같은 실수 반복 |
| **WHO** | Obsidian 헤비 유저 (500+ 노트), AI 코딩 개발자 |
| **RISK** | FSRS 파라미터가 개인 지식에 맞지 않을 수 있음 (학습 카드용으로 설계된 알고리즘) |
| **SUCCESS** | 감쇠 계산 정확도 > 85%, 리마인드 후 노트 재방문율 > 30%, 10K 노트 배치 < 5초 |
| **SCOPE** | FSRS 엔진 + DB 스키마 + MCP tool + CLI 명령 + 3D 시각화 연동 |

---

## 1. Overview

### 1.1 Purpose

FSRS (Free Spaced Repetition Scheduler)의 기억 강도 모델을 개인 지식 노트에 적용하여:
- 각 노트의 "기억 강도(retrievability)"를 0~1로 계산
- 시간이 지나면 자연 감쇠, 접근/검색/MCP 쿼리 시 리셋
- 감쇠 임계값 이하 노트를 리마인드 제안

### 1.2 Background

- FSRS-6는 Anki 등 SRS(Spaced Repetition System)에서 검증된 기억 모델
- Vestige가 에이전트 세션 메모리에 FSRS를 적용했지만, 개인 지식 노트 전체에 적용한 도구는 없음
- 3D 그래프에서 감쇠를 시각화하면 "살아있는 지식" 메시지 전달

### 1.3 Related Documents

- PRD: `docs/00-pm/core.prd.md` (F09, US-5.1, TS-7, G6)
- Phase 4a Report: `docs/04-report/features/core.report.md`

---

## 2. Scope

### 2.1 In Scope

- [ ] FSRS 감쇠 엔진 (`core/src/intelligence/fsrs.ts`)
- [ ] 접근 이벤트 추적 (노트 열기, MCP 쿼리, 검색 결과 클릭)
- [ ] DB 스키마 확장 (access_log + decay_state 테이블)
- [ ] MCP tool: `get-decay-status` (노트별/클러스터별 감쇠 상태)
- [ ] CLI: `ekh decay` (감쇠 리포트 + 리마인드 목록)
- [ ] 3D 그래프: 감쇠 노드 시각화 (opacity/size 감소)
- [ ] API: `GET /api/decay` (감쇠 데이터 반환)

### 2.2 Out of Scope

- 사용자 피드백 루프 ("아직 기억함"/"잊었음" 버튼) — Phase 4c
- 리마인드 알림 (데스크탑 노티피케이션) — Phase 4c
- 적응형 검색 가중치 반영 (F11) — 별도 기능
- FSRS 파라미터 자동 튜닝 — 초기에는 기본값 사용

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | FSRS-6 기반 기억 강도(retrievability) 계산: stability, difficulty, elapsed_days → R값 (0~1) | High | Pending |
| FR-02 | 접근 이벤트 로깅: 노트 열기(API), MCP 쿼리(search hit), 검색 클릭(graph) | High | Pending |
| FR-03 | 감쇠 상태 배치 계산: 전체 노트의 R값을 일괄 계산 (10K < 5초) | High | Pending |
| FR-04 | MCP tool `get-decay-status`: 감쇠 임계값 이하 노트 목록 반환 | High | Pending |
| FR-05 | CLI `ekh decay`: 감쇠 리포트 (Top 20 잊어가는 노트 + 클러스터별 건강도) | Medium | Pending |
| FR-06 | 3D 그래프 감쇠 오버레이: R < 0.5 노드 opacity 감소, R < 0.3 크기 축소 | Medium | Pending |
| FR-07 | API `GET /api/decay`: 노트별 R값 + 클러스터별 평균 R | Medium | Pending |
| FR-08 | 감쇠 토글 UI: 그래프 헤더에 "Decay" 버튼으로 오버레이 ON/OFF | Low | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement |
|----------|----------|-------------|
| Performance | 10K 노트 배치 감쇠 계산 < 5초 | 타이머 |
| Performance | API /api/decay 응답 < 500ms | 타이머 |
| Accuracy | 감쇠 예측 정확도 > 85% (수동 평가) | 사용자 피드백 |
| Storage | access_log 크기 < 50MB (1년, 10K 노트) | DB 크기 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] SC-01: FSRS 감쇠 R값이 30일 미접근 노트에서 < 0.5로 계산됨
- [ ] SC-02: 노트 접근 시 R값이 리셋(~1.0)되고 stability 증가
- [ ] SC-03: `ekh decay` CLI가 Top 20 감쇠 노트 + 클러스터 건강도 출력
- [ ] SC-04: MCP `get-decay-status`가 임계값 이하 노트 반환
- [ ] SC-05: 3D 그래프에서 감쇠 노드가 시각적으로 구분됨
- [ ] SC-06: 기존 102 tests 통과 + 신규 8+ 추가 (총 110+)

### 4.2 Quality Criteria

- [ ] 기존 102 tests 유지 (zero regression)
- [ ] FSRS 계산 단위 테스트 5+
- [ ] API/MCP 통합 테스트 3+

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| FSRS 파라미터가 지식 노트에 부적합 | High | Medium | 기본 파라미터 + 향후 피드백 기반 튜닝. 초기에는 단순 시간 감쇠로 fallback |
| access_log가 DB 크기를 급격히 키움 | Medium | Low | 30일 이상 된 로그 자동 정리. 일별 집계로 압축 |
| 감쇠 시각화가 그래프 성능 저하 | Medium | Low | 감쇠 데이터를 별도 캐시. useFrame에서 직접 계산하지 않음 |

---

## 6. Impact Analysis

### 6.1 Changed Resources

| Resource | Type | Change |
|----------|------|--------|
| `sqlite-vec.ts` | Store | access_log + decay_state 테이블 추가 |
| `server.ts` | API | GET /api/decay 엔드포인트 추가 |
| `mcp/server.ts` | MCP | get-decay-status tool 등록 |
| `graph-store.ts` | Store | decayData 상태 추가 |
| `GraphNodes.tsx` | Component | 감쇠 오버레이 (opacity/size) |

### 6.2 Verification

- [ ] 기존 인덱싱 플로우 영향 없음
- [ ] 기존 검색 품질 영향 없음
- [ ] 기존 그래프 성능 영향 없음

---

## 7. Architecture

### 7.1 Project Level: Dynamic

### 7.2 Key Decisions

| Decision | Selected | Rationale |
|----------|----------|-----------|
| FSRS 구현 | 직접 구현 (ts-fsrs 참고) | 의존성 최소화, 커스텀 파라미터 |
| 이벤트 수집 | API 미들웨어 + MCP 후처리 | 기존 코드 최소 변경 |
| 감쇠 저장 | SQLite 테이블 | 기존 DB 활용, 별도 파일 불필요 |
| 시각화 | GraphNodes useEffect 확장 | 기존 하이라이트 패턴 재사용 |

### 7.3 폴더 구조

```
packages/core/src/
├── intelligence/          [NEW] 지식 인텔리전스 레이어
│   ├── fsrs.ts            FSRS-6 알고리즘 (순수 함수)
│   ├── decay-engine.ts    감쇠 엔진 (DB 연동)
│   └── types.ts           DecayState, AccessEvent 타입
├── store/
│   └── sqlite-vec.ts      [MOD] access_log, decay_state 테이블
├── api/
│   └── server.ts          [MOD] GET /api/decay
├── mcp/
│   ├── server.ts          [MOD] get-decay-status 등록
│   └── tools/
│       └── decay.ts       [NEW] get-decay-status 구현

packages/graph/src/
├── stores/
│   └── graph-store.ts     [MOD] decayData 상태
├── hooks/
│   └── useDecay.ts        [NEW] 감쇠 데이터 로딩
├── components/
│   └── GraphNodes.tsx     [MOD] 감쇠 오버레이

packages/cli/src/
└── commands/
    └── decay-cmd.ts       [NEW] ekh decay 명령
```

---

## 8. Implementation Order

| # | 모듈 | 파일 | 예상 |
|---|------|------|------|
| 1 | FSRS 알고리즘 | `intelligence/fsrs.ts` + `types.ts` | ~150 lines |
| 2 | DB 스키마 | `sqlite-vec.ts` 확장 | ~80 lines |
| 3 | 감쇠 엔진 | `intelligence/decay-engine.ts` | ~120 lines |
| 4 | 이벤트 수집 | `server.ts` 미들웨어 + MCP 후처리 | ~50 lines |
| 5 | MCP tool | `mcp/tools/decay.ts` + 등록 | ~60 lines |
| 6 | CLI 명령 | `cli/commands/decay-cmd.ts` | ~60 lines |
| 7 | API 엔드포인트 | `server.ts` GET /api/decay | ~30 lines |
| 8 | 그래프 시각화 | `useDecay.ts` + `GraphNodes.tsx` | ~80 lines |
| 9 | 테스트 | fsrs.test.ts + decay.test.ts | ~100 lines |

---

## 9. Next Steps

1. [ ] Design 문서 작성 (`/pdca design fsrs-decay`)
2. [ ] 구현 (Session 1~9)
3. [ ] Gap 분석
4. [ ] 완료 보고서

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-31 | Initial draft | Evan (KHS) |
