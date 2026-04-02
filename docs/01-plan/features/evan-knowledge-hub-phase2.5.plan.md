# Evan Knowledge Hub Phase 2.5 — Motion Control + Constellation View

> **Summary**: 웹캠 손 제스처로 3D 지식 그래프를 제어하고, 별자리 뷰로 지식 우주를 탐험하며, SVG 프로필 카드로 공유
>
> **Project**: evan-knowledge-hub (notion-obsidian-sync monorepo)
> **Version**: 0.1.0
> **Author**: Evan (KHS)
> **Date**: 2026-03-30
> **Status**: Draft
> **Phase 2 Report**: `docs/04-report/features/evan-knowledge-hub-phase2.report.md`

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 마우스/키보드만으로는 3D 지식 탐험이 제한적. 클러스터 구조가 시각적으로 의미없는 색상 점 묶음. 지식 그래프를 외부에 공유할 방법 없음 |
| **Solution** | MediaPipe Hands로 손 제스처 → 그래프 제어, 클러스터를 별자리로 시각화 (줌아웃=우주, 줌인=노드), GitHub SVG 프로필 카드 자동 생성 |
| **Function/UX Effect** | 손으로 우주를 회전하며 별자리(지식 클러스터)를 탐험하는 몰입 경험. README에 지식 프로필 카드 임베드 |
| **Core Value** | "손으로 만지는 지식 우주" — 데모 영상 자체가 바이럴. 프로필 카드로 개인 브랜딩 |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 마우스 인터랙션의 한계 + 클러스터 시각적 의미 부족 + 외부 공유 불가 |
| **WHO** | Phase 2 사용자 + 데모 시청자 + GitHub 프로필 관심 개발자 |
| **RISK** | MediaPipe 성능 (30fps 트래킹 + 60fps 렌더링 동시), 웹캠 권한 거부 시 폴백 |
| **SUCCESS** | 제스처 인식 정확도 >90%, 별자리 전환 자연스러움, 카드 생성 3초 이내 |
| **SCOPE** | 모션 제어 + 별자리 뷰 + 프로필 카드. 마켓플레이스/Pro는 Phase 3 |

---

## 1. Scope

### 1.1 In Scope

| ID | Feature | Priority | Description |
|----|---------|:--------:|-------------|
| F-MOTION | 웹캠 모션 제어 | P0 | MediaPipe Hands → 6개 제스처 → OrbitControls 대체 |
| F-CONST | 별자리 뷰 | P0 | 클러스터 → 별자리 형태, 줌레벨 자동 전환, 별자리 라벨 |
| F-CARD | 지식 프로필 카드 | P1 | SVG 자동 생성 (레이더 차트 + 워드클라우드), API 엔드포인트 |

### 1.2 Out of Scope

- VR/AR 지원 (WebXR)
- 음성 명령
- 멀티 유저 동시 제어

---

## 2. Requirements

### 2.1 Functional Requirements

#### 모션 제어 (F-MOTION)

| ID | Requirement | Priority |
|----|-------------|:--------:|
| FR-01 | MediaPipe Hands 초기화 (WASM/WebGL, 브라우저 전용) | P0 |
| FR-02 | 웹캠 스트림 → 21 hand landmarks, 30fps 트래킹 | P0 |
| FR-03 | ✋ 펼친 손 + 이동 → 그래프 회전 (orbit) | P0 |
| FR-04 | ✊ 주먹 + 이동 → 패닝 (pan) | P0 |
| FR-05 | 🤏 핀치 (엄지+검지 거리) → 줌 in/out | P0 |
| FR-06 | 👆 검지 포인팅 → 노드 선택 (raycast) | P0 |
| FR-07 | 👋 손 흔들기 → 뷰 리셋 | P1 |
| FR-08 | 우측 하단 웹캠 미리보기 (작은 PIP) + 현재 제스처 표시 | P0 |
| FR-09 | 모션 ON/OFF 토글 버튼 + 웹캠 권한 거부 시 마우스 폴백 | P0 |

#### 별자리 뷰 (F-CONST)

| ID | Requirement | Priority |
|----|-------------|:--------:|
| FR-10 | 줌아웃 시 (거리 > 500) 자동으로 별자리 뷰 전환 | P0 |
| FR-11 | 각 클러스터 → 대표 노드 연결하여 별자리 형태 라인 | P0 |
| FR-12 | 별자리 라벨 (클러스터명) 3D 텍스트 표시 | P0 |
| FR-13 | 줌인 시 (거리 < 300) 자동으로 개별 노드 뷰 복원 | P0 |
| FR-14 | 별자리 간 은은한 연결선 (클러스터 간 엣지) | P1 |

#### 프로필 카드 (F-CARD)

| ID | Requirement | Priority |
|----|-------------|:--------:|
| FR-15 | GET /api/profile-card → SVG 반환 | P1 |
| FR-16 | 클러스터 분포 레이더 차트 (상위 6개 클러스터) | P1 |
| FR-17 | 토픽 워드클라우드 (빈출 태그) | P1 |
| FR-18 | 문서 수, 클러스터 수, 총 연결 수 통계 | P1 |
| FR-19 | `ekh card` CLI 명령어 → SVG 파일 생성 | P1 |

### 2.2 Non-Functional Requirements

| Category | Criteria | Target |
|----------|----------|--------|
| Performance | MediaPipe 30fps + 렌더링 60fps 동시 | 프레임 드랍 없음 |
| UX | 제스처 → 반응 지연 | < 100ms |
| Compatibility | 웹캠 없는 환경 | 마우스 폴백 100% 동작 |
| Privacy | 웹캠 데이터 | 로컬 전용, 네트워크 전송 없음 |

---

## 3. Success Criteria

| ID | Criteria | Measurement |
|----|----------|-------------|
| SC-01 | 5개 핵심 제스처 인식 정확도 >90% | 수동 테스트 (20회 반복) |
| SC-02 | 별자리 뷰 전환 시 자연스러운 트랜지션 (<0.5초) | 수동 측정 |
| SC-03 | 프로필 카드 SVG 생성 <3초 | API 응답 시간 |
| SC-04 | 모션 OFF 시 기존 마우스 조작 100% 유지 | E2E |
| SC-05 | 웹캠 미리보기가 그래프 렌더링 성능에 영향 없음 | FPS 측정 |

---

## 4. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| MediaPipe WASM 로딩 느림 (5MB+) | Medium | Medium | lazy load + 로딩 스피너 |
| 제스처 오인식 (주먹↔핀치) | High | Medium | confidence threshold 0.8 + 제스처 안정화 (3프레임 연속) |
| 웹캠 권한 거부 | Medium | High | 토글 기본 OFF, 활성화 시에만 요청 |
| 별자리 라인 계산 (TSP-like) | Low | Medium | 간단한 MST(Minimum Spanning Tree)로 근사 |
| SVG 렌더링 복잡도 | Low | Low | 고정 템플릿 + 데이터 바인딩 |

---

## 5. Architecture

Phase 2 graph/ 패키지에 추가 모듈:

```
packages/graph/src/
├── lib/
│   ├── motion-controller.ts    MediaPipe 초기화 + 제스처 인식
│   ├── gesture-detector.ts     21 landmarks → 6 제스처 분류
│   ├── constellation.ts        클러스터 → 별자리 형태 계산 (MST)
│   └── profile-card.ts         SVG 생성 (레이더 + 워드클라우드)
├── components/
│   ├── MotionOverlay.tsx       웹캠 미리보기 PIP + 제스처 상태
│   ├── ConstellationView.tsx   별자리 라인 + 라벨 렌더링
│   └── MotionToggle.tsx        ON/OFF 버튼
├── hooks/
│   └── useMotion.ts            motion-controller 래핑
```

API 추가 (core):
```
GET /api/profile-card           SVG 프로필 카드
```

CLI 추가:
```
ekh card [-o output.svg]        프로필 카드 생성
```

---

## 6. Dependencies (Phase 2.5 추가)

| Package | Version | Purpose |
|---------|---------|---------|
| `@mediapipe/hands` | ^0.4 | 손 랜드마크 감지 |
| `@mediapipe/camera_utils` | ^0.3 | 웹캠 스트림 |
| `@mediapipe/drawing_utils` | ^0.3 | 랜드마크 시각화 (미리보기) |

---

## 7. Implementation Roadmap

| Module | Scope Key | Description | Effort |
|--------|-----------|-------------|:------:|
| 모션 컨트롤러 + 제스처 | `module-1` | MediaPipe 초기화 + 6 제스처 분류 + OrbitControls 연동 | Large |
| 웹캠 UI + 토글 | `module-2` | MotionOverlay PIP + MotionToggle + 상태 표시 | Small |
| 별자리 뷰 | `module-3` | MST 별자리 라인 + 라벨 + 줌레벨 자동 전환 | Medium |
| 프로필 카드 | `module-4` | SVG 생성 + API 엔드포인트 + CLI 명령어 | Medium |

### Session Plan

| Session | Scope | 내용 |
|---------|-------|------|
| **Session 1** | `module-1,module-2` | 모션 제어 전체 + 웹캠 UI |
| **Session 2** | `module-3` | 별자리 뷰 |
| **Session 3** | `module-4` | 프로필 카드 + 테스트 + 마무리 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-30 | Initial Phase 2.5 Plan | Evan (KHS) |
