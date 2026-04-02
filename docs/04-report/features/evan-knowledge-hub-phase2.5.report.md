# Evan Knowledge Hub Phase 2.5 — PDCA Completion Report

> **Feature**: Motion Control + Constellation View + Profile Card
> **Project**: evan-knowledge-hub (notion-obsidian-sync monorepo)
> **Author**: Evan (KHS)
> **Date**: 2026-03-30
> **Status**: Complete

---

## Executive Summary

### 1.1 Overview

| Item | Detail |
|------|--------|
| **Feature** | Motion Control + Constellation View + Profile Card |
| **Start~End** | 2026-03-30 (single session) |
| **Gap Analysis** | 74% → 90%+ (테스트 4파일 + confidence 필터 추가) |
| **PDCA Iterations** | 1 |

### 1.2 Results Summary

| Metric | Value |
|--------|-------|
| **Test Files** | 14 files, 82 tests — ALL PASS |
| **Source Files (Phase 2.5)** | 10 신규 + 3 수정 |
| **Extra Improvements** | 5개 (검색 카메라, 옵시디언 열기, 스크린샷, 테마, 단축키) |

### 1.3 Value Delivered

| Perspective | Content |
|-------------|---------|
| **Problem** | 마우스 인터랙션 한계 + 클러스터 시각적 의미 부족 + 외부 공유 불가 |
| **Solution** | MediaPipe 5제스처 모션, MST 별자리 뷰 (줌 자동 전환), SVG 프로필 카드 |
| **Function/UX** | 손으로 우주 탐험, 줌아웃→별자리, 별자리 클릭→줌인, `ekh card`→SVG |
| **Core Value** | "손으로 만지는 지식 우주" — 데모 자체가 바이럴 + GitHub 프로필 임베드 |

---

## 2. Module Delivery

| Module | Files | Description | Status |
|--------|:-----:|-------------|:------:|
| 1. MediaPipe 모션 | 3 | gesture-detector + motion-controller + useMotion | ✅ |
| 2. 모션 UI | 2 | MotionOverlay PIP + MotionToggle | ✅ |
| 3. 별자리 뷰 | 2 | constellation MST + ConstellationView + 줌 전환 | ✅ |
| 4. 프로필 카드 | 3 | profile-card SVG + API + CLI `ekh card` | ✅ |
| **개선 5개** | 5수정 | 검색 카메라, 옵시디언 열기, 스크린샷, 테마, 단축키 | ✅ |

---

## 3. Key Decisions & Outcomes

| Decision | Followed? | Outcome |
|----------|:---------:|---------|
| MediaPipe Hands WASM | ✅ | lazy load ~5MB, modelComplexity=0 (lite) |
| 3프레임 안정화 | ✅ | 오인식 방지 효과적 |
| confidence 0.7 threshold | ✅ | Gap 분석 후 추가 |
| Prim's MST 별자리 | ✅ | 자연스러운 별자리 형태 |
| 줌레벨 자동 전환 | ✅ | 300~500 페이드, 부드러운 전환 |
| HTML 라벨 (3D Text 대신) | 변경 | 더 유연한 스타일링, 클릭 인터랙션 가능 |
| SVG 인라인 (profile-card import 대신) | 변경 | 코드 중복 있으나 동작 정상 |

---

## 4. Improvements Beyond Design (9개)

| # | Feature | Category |
|---|---------|----------|
| 1 | 별자리 클릭 → 클러스터 줌인 + 하이라이트 토글 | UX |
| 2 | 활성 클러스터 라벨 유지 (노드 선택 시) | UX |
| 3 | 연결 노드 라벨 표시 | UX |
| 4 | 검색 결과 카메라 이동 | UX |
| 5 | Open in Obsidian 버튼 | 연동 |
| 6 | 스크린샷 PNG 내보내기 | 공유 |
| 7 | 다크/라이트 테마 토글 | 접근성 |
| 8 | 키보드 단축키 (ESC, /, Space, Tab, T) | 접근성 |
| 9 | 아코디언 본문 (섹션별 접기/펼치기) | UX |

---

## 5. Test Coverage

| File | Tests | Phase |
|------|:-----:|:-----:|
| chunker.test.ts | 8 | P1 |
| rrf.test.ts | 4 | P1 |
| store.test.ts | 4 | P1 |
| bm25.test.ts | 6 | P1 |
| search-integration.test.ts | 6 | P1 |
| mcp.test.ts | 11 | P1 |
| graph-data.test.ts | 7 | P2 |
| cluster.test.ts | 5 | P2 |
| layout.test.ts | 5 | P2 |
| api-routes.test.ts | 7 | P2 |
| **gesture-detector.test.ts** | **6** | **P2.5** |
| **constellation.test.ts** | **6** | **P2.5** |
| **profile-card.test.ts** | **4** | **P2.5** |
| **api-card.test.ts** | **3** | **P2.5** |
| **Total** | **82** | |

---

## 6. Lessons Learned

| # | Lesson | Category |
|---|--------|----------|
| 1 | MediaPipe Hands는 modelComplexity=0 (lite)으로 충분, WASM lazy load 필수 | Performance |
| 2 | R3F InstancedMesh 컬러 문제 → Points가 포인트 클라우드에 적합 | Technical |
| 3 | Canvas click 감지는 mousedown/up 거리 판정이 R3F 이벤트보다 안정적 | R3F |
| 4 | 별자리 라벨은 HTML이 3D Text보다 유연 (클릭, 스타일링, 접근성) | UX |
| 5 | zustand store에 모든 상태 통합이 window 전역 변수보다 안정적 | State |
| 6 | 비주얼 피드백은 코드보다 사용자와 반복 대화로 완성됨 | Process |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-03-30 | Phase 2.5 Completion Report | Evan (KHS) |
