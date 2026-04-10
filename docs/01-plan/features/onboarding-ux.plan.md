# onboarding-ux Planning Document

> **Summary**: 3가지 페르소나 시뮬레이션으로 런칭 전 온보딩 마찰 포인트를 식별하고 블로커를 제거하는 최종 검증 + 개선 Plan
>
> **Project**: Stellavault
> **Version**: v0.4.3+
> **Author**: PM Agent
> **Date**: 2026-04-06
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 완전 초보자 / Obsidian 파워유저 / Claude Code MCP 유저 — 세 페르소나가 각각 다른 온보딩 장벽을 경험하며, 어느 하나라도 blocker가 남으면 런칭 후 이탈률이 급등함 |
| **Solution** | 3 페르소나별 시나리오를 시뮬레이션하여 마찰 지점 2개 + blocker 0-1개를 식별하고, Critical blocker는 즉시 수정, 마찰은 UX 개선(README / CLI 메시지 / 웹 UI 힌트)으로 해결 |
| **Function/UX Effect** | npm install → init → graph 경로의 장벽 제거, Obsidian vault 연결 가이드 개선, MCP 연동 체험 강화로 "처음 5분"이 성공 경험으로 전환됨 |
| **Core Value** | 런칭 Go/No-Go 기준 충족 + 각 페르소나에게 "이걸 왜 써야 하지?"를 대답하는 최소한의 WOW 모멘트 제공 |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 런칭 전 마지막 라운드 — 실 사용자 관점의 블로커가 하나라도 남으면 초기 채택률이 무너짐 |
| **WHO** | 완전 초보(코딩 경험 0) / Obsidian 1년차 / Claude Code 파워유저 — 기대치와 멘탈 모델이 완전히 다른 3계층 |
| **RISK** | 시뮬레이션이 실제 유저 행동과 다를 수 있음; CLI 오류 메시지 부재로 초보자가 조용히 이탈; Obsidian 유저는 설득 없이 설치 안 함 |
| **SUCCESS** | 3 페르소나 각각 "처음 5분" 완주율 100%, Critical blocker 0건, 런칭 준비도 7점 이상 |
| **SCOPE** | 이번 Plan: 시뮬레이션 + 식별 + Critical 수정. 다음 이터레이션: UX 폴리싱, 마케팅 카피 |

---

## 1. Overview

### 1.1 Purpose

Stellavault v0.4.3+의 런칭 전 최종 온보딩 검증. 세 가지 실제 페르소나 시나리오를 시뮬레이션하여:

1. 온보딩 마찰 포인트를 페르소나별로 정확히 식별
2. Critical blocker를 즉시 수정
3. 런칭 준비도(Go/No-Go) 결정을 위한 객관적 근거 확보
4. 각 페르소나에 맞는 마케팅 메시지 도출

### 1.2 Background

현재 Stellavault는 Capture/Organize/Distill/Express/Memory/Search/Visualize/Editor/AI/Security 전 기능이 구현 완료된 상태. 문제는 기능이 완성되어도 "처음 5분"에 막히면 사용자가 이탈한다는 것. 3라운드 최종 테스트는 구현 검증이 아닌 **온보딩 경험 검증**에 집중한다.

### 1.3 Related Documents

- 기존 Plan: `docs/01-plan/features/auto-wiki-pipeline.plan.md`
- Phase3 Plan: `docs/01-plan/features/evan-knowledge-hub-phase3.plan.md`

---

## 2. Scope

### 2.1 In Scope

- [ ] **페르소나 A**: 완전 초보 — npm install → init → graph 플로우 시뮬레이션
- [ ] **페르소나 B**: Obsidian 1년차 — 기존 vault 연결 → 검색 품질 비교 플로우
- [ ] **페르소나 C**: Claude Code 파워유저 — MCP 연동 → 21개 도구 탐색 플로우
- [ ] 각 페르소나별 온보딩 마찰 2개 식별 및 문서화
- [ ] Critical blocker (런칭 블로킹) 수정
- [ ] 런칭 준비도 점수 (10점 척도) 산출
- [ ] Go/No-Go 결정
- [ ] 페르소나별 마케팅 메시지 초안

### 2.2 Out of Scope

- 기능 신규 추가 (v0.5.x 대상)
- Non-critical UX 폴리싱 (다음 이터레이션)
- 실 사용자 인터뷰/베타 테스트 (런칭 후)
- 다국어 온보딩 문서 (런칭 후)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 페르소나 A: `npm install -g stellavault` → `stellavault init` → `stellavault graph` 전 과정 에러 없이 완주 가능 | Must | Pending |
| FR-02 | 페르소나 A: 각 CLI 명령어에 --help 또는 진행 힌트가 존재하여 코딩 경험 없이도 다음 단계를 알 수 있음 | Must | Pending |
| FR-03 | 페르소나 B: 기존 Obsidian vault 경로를 init 시 지정하면 기존 노트가 자동 인식됨 | Must | Pending |
| FR-04 | 페르소나 B: `stellavault ask "질문"` 결과가 Obsidian 내장 검색보다 명백히 유용한 답변을 제공 (WOW 모멘트) | Should | Pending |
| FR-05 | 페르소나 C: `claude mcp add` 후 21개 도구가 MCP 클라이언트에서 열거됨 | Must | Pending |
| FR-06 | 페르소나 C: 핵심 MCP 도구 3개 이상이 다른 MCP 서버와 차별화된 기능을 제공 (semantic-search, ask, compile 등) | Should | Pending |
| FR-07 | 온보딩 플로우 중 발생하는 모든 에러가 actionable한 메시지를 포함 (에러 원인 + 해결 방법) | Must | Pending |
| FR-08 | README의 Quick Start 섹션이 5분 내 완주 가능한 스텝으로 구성됨 | Must | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Time-to-First-Value | 각 페르소나 "처음 5분" 내 첫 번째 성공 경험 달성 | 시뮬레이션 스텝별 소요 시간 측정 |
| Error Clarity | CLI 에러 발생 시 해결 방법이 메시지에 포함 | 에러 케이스 전수 확인 |
| Discoverability | 다음 단계 힌트 없이 막히는 지점 0 (완주 기준) | 시나리오 플로우 추적 |
| WOW Density | 페르소나별 최소 1개의 "이걸 왜 써야 하지?" 해소 모멘트 | 기능 가치 명시성 확인 |

---

## 4. 페르소나별 시나리오 정의

### 4.1 페르소나 A: 완전 초보

**프로필**: 코딩 경험 0, "세컨드 브레인이 뭔데?" 단계, YouTube 영상 보고 시도

**온보딩 플로우**:
```
npm install -g stellavault
  → stellavault init (vault 경로 입력)
  → stellavault ingest "https://youtube.com/..." (첫 번째 콘텐츠)
  → stellavault ask "방금 본 영상에서 뭘 배웠지?"
  → stellavault graph (시각화 확인)
```

**성공 기준**: 가이드 없이 위 5단계 완주

**예상 마찰 포인트**:
- Node.js 버전 불일치 시 에러 메시지 불명확
- `init` 후 "다음에 뭘 하지?" 힌트 부재
- `graph` 실행 시 브라우저 미자동 오픈

### 4.2 페르소나 B: Obsidian 1년차

**프로필**: 플러그인 50개, Dataview/Templater 사용자, vault 3년치 보유

**온보딩 플로우**:
```
stellavault init --vault ~/ObsidianVault
  → stellavault ask "내 vault에서 프로젝트 관리에 관한 노트는?"
  → (Obsidian 내장 검색과 비교)
  → stellavault compile (기존 노트 정제 경험)
  → stellavault graph (기존 연결망 시각화)
```

**성공 기준**: "이 도구가 Obsidian 플러그인보다 나은 이유"를 스스로 발견

**예상 마찰 포인트**:
- 기존 vault의 wikilink가 충돌하거나 무시됨
- Obsidian frontmatter 호환성 불확실
- 검색 결과의 소스 인용이 Obsidian 경로와 매칭 안 됨

### 4.3 페르소나 C: Claude Code 파워유저

**프로필**: MCP 서버 5개 사용 중, Claude Code daily user, 자동화 세팅에 능숙

**온보딩 플로우**:
```
claude mcp add stellavault-mcp
  → (Claude Code에서) @stellavault ask "..."
  → (21개 도구 탐색)
  → generate-draft, compile, semantic-search 실사용
  → "다른 MCP 서버와 뭐가 다르지?" 판단
```

**성공 기준**: 기존 워크플로우에 Stellavault MCP를 통합하는 구체적 use case 발견

**예상 마찰 포인트**:
- MCP 서버 설정 파일 경로 문서화 부재
- 21개 도구 중 "지금 당장 유용한 것" 가이드 없음
- 다른 MCP 서버(filesystem, memory 등)와의 차별점 불명확

---

## 5. Success Criteria

### 5.1 Definition of Done

- [ ] 3 페르소나 시뮬레이션 완료 및 결과 문서화
- [ ] 발견된 Critical blocker 전부 수정 완료
- [ ] 런칭 준비도 점수 7.0 이상 달성
- [ ] Go/No-Go 결정 및 근거 문서화
- [ ] 페르소나별 마케팅 메시지 초안 1개 이상

### 5.2 Quality Criteria

- [ ] 각 페르소나 "처음 5분" 플로우 무중단 완주
- [ ] CLI 에러 메시지 actionable 여부 100% 통과
- [ ] README Quick Start 5분 내 완주 가능

### 5.3 런칭 준비도 채점 기준

| 항목 | 만점 | 기준 |
|------|------|------|
| 초보자 완주율 | 2점 | 가이드 없이 5단계 완주 |
| Obsidian 유저 WOW | 2점 | "이걸 써야 하는 이유" 자발 발견 |
| MCP 유저 차별점 | 2점 | 기존 MCP와 명확한 차별화 |
| 에러 처리 품질 | 2점 | 모든 에러가 actionable |
| 문서 완성도 | 2점 | README Quick Start 5분 완주 |

---

## 6. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Node.js 버전 의존성으로 초보자 설치 실패 | High | Medium | `.nvmrc` + `engines` 필드 + 명확한 에러 메시지 |
| Obsidian vault frontmatter 파싱 충돌 | High | Medium | 기존 파일 read-only + 비파괴적 인제스트 검증 |
| MCP 설정 복잡성으로 파워유저도 포기 | Medium | Low | `stellavault mcp-setup` 원클릭 설정 명령어 검토 |
| 시뮬레이션이 실제 사용자 행동과 괴리 | Medium | High | 시나리오를 최대한 실 사용자 관점에서 서술, 이후 베타 검증 |
| Critical blocker 발견 시 일정 지연 | High | Medium | blocker 발견 즉시 수정 → 재검증 루프 포함 |

---

## 7. MoSCoW Prioritization

### Must (런칭 블로킹)

- FR-01: 초보자 전체 플로우 에러 없이 완주
- FR-02: CLI 단계별 힌트 제공
- FR-03: Obsidian vault 자동 인식
- FR-05: MCP 21개 도구 정상 열거
- FR-07: 모든 에러에 actionable 메시지
- FR-08: README Quick Start 5분 완주

### Should (런칭 품질 향상)

- FR-04: Obsidian 검색 대비 WOW 모멘트
- FR-06: MCP 차별화 가이드

### Could (다음 이터레이션)

- 대화형 온보딩 wizard (`stellavault setup`)
- 비디오 튜토리얼 링크
- 페르소나별 맞춤 README 섹션

### Won't (이번 스코프 외)

- 실 사용자 베타 프로그램
- 다국어 온보딩 문서
- 인앱 온보딩 튜토리얼 (웹 UI)

---

## 8. Impact Analysis

### 8.1 Changed Resources

| Resource | Type | Change Description |
|----------|------|--------------------|
| README.md | 문서 | Quick Start 섹션 개선 |
| CLI 에러 메시지 | 코드 (packages/cli) | actionable 메시지로 교체 |
| `stellavault init` | CLI 커맨드 | 완료 후 Next Step 힌트 추가 |
| MCP 설정 가이드 | 문서 | `claude mcp add` 명확한 스텝 추가 |

### 8.2 Current Consumers

| Resource | Operation | Code Path | Impact |
|----------|-----------|-----------|--------|
| README Quick Start | READ | 신규 사용자 → npm install | None (개선만) |
| CLI init | EXEC | packages/cli/src/commands/init.ts | Needs verification |
| CLI 에러 핸들러 | READ | packages/cli/src/utils/error.ts | Needs verification |

### 8.3 Verification

- [ ] CLI 변경이 기존 사용자 워크플로우를 깨지 않는지 확인
- [ ] README 변경이 기존 설치 가이드와 충돌하지 않는지 확인

---

## 9. Architecture Considerations

### 9.1 Project Level Selection

| Level | Selected |
|-------|:--------:|
| Dynamic (현재 Stellavault 수준) | X |

### 9.2 Key Decisions

| Decision | Selected | Rationale |
|----------|----------|-----------|
| 온보딩 개선 범위 | CLI 메시지 + 문서 | 코드 변경 최소화, 런칭 일정 우선 |
| MCP 설정 방식 | 기존 방식 개선 (신규 명령어 X) | 범위 초과 방지 |
| Obsidian 호환성 | Read-only 방식 유지 | 데이터 안전성 최우선 |

---

## 10. 런칭 준비도 평가 프레임워크

### 10.1 Go 기준 (7점 이상)

- Critical blocker 0건
- 3 페르소나 모두 첫 5분 내 첫 번째 성공 경험 달성
- 에러 메시지 전수 actionable

### 10.2 No-Go 기준 (7점 미만)

- Critical blocker 1건 이상 미수정
- 어느 페르소나든 첫 5분 내 포기 지점 발생
- MCP 연동 자체가 실패

### 10.3 마케팅 메시지 프레임

| 페르소나 | 핵심 가치 | 메시지 방향 |
|----------|----------|------------|
| 완전 초보 | "기억이 연결되는 경험" | "노트를 넣으면, 지식이 됩니다" |
| Obsidian 유저 | "AI가 추가된 두 번째 뇌" | "Obsidian이 생각하기 시작합니다" |
| Claude Code 유저 | "지식 기반이 있는 AI 어시스턴트" | "당신의 코딩 맥락을 기억하는 MCP" |

---

## 11. Next Steps

1. [ ] 페르소나 A 시뮬레이션 실행 → 마찰 2개 + blocker 문서화
2. [ ] 페르소나 B 시뮬레이션 실행 → 마찰 2개 + blocker 문서화
3. [ ] 페르소나 C 시뮬레이션 실행 → 마찰 2개 + blocker 문서화
4. [ ] Critical blocker 수정 (`/pdca do onboarding-ux`)
5. [ ] 런칭 준비도 점수 산출
6. [ ] Go/No-Go 결정

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-04-06 | Initial draft | PM Agent |
