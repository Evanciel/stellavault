# Phase 4c: Knowledge Depth — Plan Document

> **Summary**: 지식 진화 타임라인(F02) + 코드-지식 링커(F15)
>
> **Project**: stellavault
> **Version**: 0.3.0
> **Author**: Evan (KHS)
> **Date**: 2026-04-04
> **Status**: Draft
> **PRD**: `docs/00-pm/core.prd.md` §7.3.3

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | Phase 4b로 인텔리전스 기반 확보. 이제 시간적 차원(진화)과 코드-지식 연결로 "4D 지식 플랫폼" 완성 |
| **WHO** | Claude Code 개발자 (코드-지식 링커), 지식 관리자 (진화 추적) |
| **RISK** | 시맨틱 드리프트 계산 비용; git 파싱 정확도 |
| **SUCCESS** | SC-01~04 PASS |
| **SCOPE** | F02 + F15. F05 클러스터링 업그레이드는 다음 사이클 |

---

## 1. Already Implemented

| 모듈 | 파일 | 상태 |
|------|------|------|
| Semantic drift 계산 | `intelligence/semantic-versioning.ts` | ✅ `computeSemanticDrift`, `findMostDrifted` |
| Timeline UI | `graph/components/Timeline.tsx` | ✅ 히스토그램 + 듀얼 슬라이더 |
| Timeline store | `graph/stores/graph-store.ts` | ✅ `showTimeline`, `timelineRange` |

## 2. Implementation Plan

### F02: Evolution MCP Tool

- `mcp/tools/get-evolution.ts` NEW — 특정 주제의 시맨틱 드리프트 추적
- `/api/evolution` NEW — 전체 vault 드리프트 데이터 반환
- Success Criteria:
  - SC-01: MCP get-evolution이 주제별 드리프트 반환
  - SC-02: drift > 0.1인 변화 정확히 감지

### F15: Code-Knowledge Linker

- `intelligence/code-linker.ts` NEW — git diff/file 키워드 → 노트 매칭
- `mcp/tools/link-code.ts` NEW — MCP tool
- `cli/commands/link-cmd.ts` — CLI (선택)
- Success Criteria:
  - SC-03: 코드 파일 경로/내용에서 관련 노트 3개+ 반환
  - SC-04: 기존 121 tests 통과

---

## 3. File Plan

| # | 파일 | Action |
|---|------|--------|
| 1 | `core/src/api/server.ts` | MOD — /api/evolution 추가 |
| 2 | `core/src/mcp/tools/get-evolution.ts` | NEW |
| 3 | `core/src/mcp/server.ts` | MOD — 등록 |
| 4 | `core/src/intelligence/code-linker.ts` | NEW |
| 5 | `core/src/mcp/tools/link-code.ts` | NEW |
| 6 | `core/tests/code-linker.test.ts` | NEW |
