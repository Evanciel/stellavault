# Phase 2.5: Motion + Constellation + Card — Retrospective Gap Analysis

> **Feature**: Motion Control + Constellation View + Profile Card
> **Match Rate**: 74% → 90%+ (1 iteration)
> **Date**: 2026-04-04 (retrospective)
> **Status**: Completed
> **Design Doc**: [evan-knowledge-hub-phase2.5.design.md](../../02-design/features/evan-knowledge-hub-phase2.5.design.md)
> **Report**: [evan-knowledge-hub-phase2.5.report.md](../../04-report/features/evan-knowledge-hub-phase2.5.report.md)

---

## Summary

MediaPipe 5제스처 모션, MST 별자리 뷰, SVG 프로필 카드 구현. 초기 74%에서 테스트 4파일 + confidence 필터 추가 후 90%+ 달성.

## Match Rate Breakdown

| Category | Design | Implementation | Match |
|----------|--------|---------------|:-----:|
| MediaPipe 모션 (3 files) | ✅ | ✅ gesture-detector, motion-controller, useMotion | 100% |
| 모션 UI (2 files) | ✅ | ✅ MotionOverlay PIP, MotionToggle | 100% |
| 별자리 뷰 (2 files) | ✅ | ✅ constellation MST, ConstellationView | 100% |
| 프로필 카드 (3 files) | ✅ | ✅ profile-card SVG, API, CLI | 100% |
| Tests | ⚠️ | 초기 부족 → 4파일 추가 | 90% |
| Confidence filter | ⚠️ | 초기 누락 → 0.7 threshold 추가 | 90% |

## Gaps (Initial 74%)

1. 테스트 부족 → 4파일 추가
2. MediaPipe confidence threshold 누락 → 0.7 필터 추가
3. 3프레임 안정화는 설계대로 구현

## Iteration

1회 iteration: 테스트 4파일 + confidence 필터 → 82 tests ALL PASS, 90%+ 달성

## Additional (Design 외)

5개 추가: 검색 카메라 이동, Obsidian 열기, 스크린샷, 테마, 단축키
