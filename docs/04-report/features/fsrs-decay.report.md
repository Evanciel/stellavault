# F09: FSRS Knowledge Decay — Completion Report

> **Feature**: FSRS Knowledge Decay Model
> **Phase**: 4b
> **Date**: 2026-03-31
> **Match Rate**: 95%+ (PASS)
> **Tests**: 116 ALL PASS (14 new FSRS tests)

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 1,200+ 노트가 쌓이지만 잊어가는 지식을 감지할 방법 없음 |
| **Solution** | FSRS-6 기반 기억 강도 추적 + 감쇠 시각화 + MCP/CLI/API 통합 |
| **UX Effect** | 3D 그래프 Decay 토글로 잊어가는 노트 시각화, CLI로 리마인드 목록 |
| **Value Delivered** | "잊어가는 것을 알려주는 살아있는 지식" — 경쟁사 없는 독자 기능 |

---

## Results

### Success Criteria

| ID | Criteria | Status | Evidence |
|----|----------|:------:|----------|
| SC-01 | FSRS R값 계산 (90일 미접근 R<0.5) | ✅ | fsrs.test.ts: R(90, S=7)=0.41 |
| SC-02 | 접근 시 stability 증가 | ✅ | fsrs.test.ts: updateStability tests |
| SC-03 | CLI ekh decay 리포트 | ✅ | decay-cmd.ts 구현 |
| SC-04 | MCP get-decay-status | ✅ | decay.ts + server.ts 등록 |
| SC-05 | 3D 감쇠 시각화 | ✅ | GraphNodes.tsx decay overlay |
| SC-06 | 기존 102 tests + 신규 8+ | ✅ | 116 ALL PASS (+14) |

### Deliverables

| Module | Files | Lines | Status |
|--------|:-----:|:-----:|:------:|
| FSRS Algorithm | 2 (fsrs.ts, types.ts) | ~120 | ✅ |
| Decay Engine | 1 (decay-engine.ts) | ~170 | ✅ |
| MCP Tool | 2 (decay.ts, server.ts mod) | ~50 | ✅ |
| CLI Command | 2 (decay-cmd.ts, index.ts mod) | ~60 | ✅ |
| API Endpoint | 1 (server.ts mod) | ~30 | ✅ |
| 3D Visualization | 4 (useDecay, GraphNodes, Graph3D, Layout mod) | ~80 | ✅ |
| Store Extension | 1 (graph-store.ts mod) | ~15 | ✅ |
| Tests | 1 (fsrs.test.ts) | ~100 | ✅ |
| **Total** | **14 files** | **~625 lines** | ✅ |

### Architecture

```
Intelligence Layer (NEW)
├── fsrs.ts          순수 함수 (R 계산, S 업데이트, 초기 추정)
├── types.ts         DecayState, AccessEvent, DecayReport
└── decay-engine.ts  DB 연동 (access_log, decay_state, 배치 계산)

Integration Points
├── API: GET /api/decay + /api/document/:id 접근 기록
├── MCP: get-decay-status (11번째 tool)
├── CLI: ekh decay
└── Graph: Decay 토글 → GraphNodes opacity/size 조절
```

### MCP Tools (10 → 11)

| # | Tool | Phase |
|---|------|-------|
| 1-10 | (기존) | Phase 1-3 |
| **11** | **get-decay-status** | **Phase 4b** |

---

## Key Decisions & Outcomes

| Decision | Selected | Outcome |
|----------|----------|---------|
| FSRS 구현 방식 | 직접 구현 (ts-fsrs 참고) | 의존성 0, 커스텀 파라미터 가능 |
| 초기 stability | 7일 + 크기/연결 보너스 | 노트 특성 반영 |
| 이벤트 수집 | API 미들웨어 | 기존 코드 최소 변경 (1줄 추가) |
| 시각화 | GraphNodes useEffect 확장 | 기존 패턴 재사용, 새 파일 불필요 |

---

## Lessons Learned

**잘된 점**:
- FSRS 알고리즘을 순수 함수로 분리 → 테스트 용이
- Intelligence Layer를 독립 디렉토리로 구성 → 향후 갭 탐지/진화 추적 추가 시 확장 용이
- DecayEngine을 optional로 주입 → 기존 코드에 영향 없음

**개선점**:
- graph-cmd.ts에 DecayEngine 전달 미구현 (API 서버에서만 동작)
- access_log 정리 로직 미구현 (30일 이상 로그 삭제)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-31 | Initial report — Phase 4b complete |
