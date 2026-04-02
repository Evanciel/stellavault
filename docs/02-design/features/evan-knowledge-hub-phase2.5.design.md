# Evan Knowledge Hub Phase 2.5 — Motion Control + Constellation View Design

> **Summary**: 웹캠 손 제스처로 3D 지식 우주를 탐험하고, 별자리로 지식 구조를 보고, SVG 카드로 공유
>
> **Project**: evan-knowledge-hub (notion-obsidian-sync monorepo)
> **Version**: 0.1.0
> **Author**: Evan (KHS)
> **Date**: 2026-03-30
> **Status**: Draft
> **Planning Doc**: [phase2.5.plan.md](../../01-plan/features/evan-knowledge-hub-phase2.5.plan.md)

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 마우스 인터랙션 한계 + 클러스터 시각적 의미 부족 + 외부 공유 불가 |
| **WHO** | Phase 2 사용자 + 데모 시청자 + GitHub 프로필 개발자 |
| **RISK** | MediaPipe 30fps + 렌더링 60fps 동시 성능, 웹캠 권한 거부 |
| **SUCCESS** | 제스처 정확도 >90%, 별자리 전환 <0.5초, 카드 생성 <3초 |
| **SCOPE** | 모션 제어 + 별자리 뷰 + 프로필 카드 |

---

## 1. Architecture (Option C: Pragmatic)

### 1.1 Component Diagram

```
packages/graph/src/
├── lib/                      [Domain — 알고리즘]
│   ├── motion-controller.ts  MediaPipe 초기화 + 웹캠 관리
│   ├── gesture-detector.ts   21 landmarks → 6 제스처 분류
│   ├── constellation.ts      클러스터 → MST 별자리 라인 계산
│   └── profile-card.ts       SVG 생성 (레이더 + 워드클라우드)
│
├── components/               [Presentation — UI]
│   ├── MotionOverlay.tsx     웹캠 PIP + 제스처 상태 표시
│   ├── MotionToggle.tsx      ON/OFF 버튼 (헤더)
│   └── ConstellationView.tsx R3F 별자리 라인 + 라벨
│
├── hooks/                    [Application — 로직]
│   └── useMotion.ts          motion-controller + gesture → OrbitControls 연동
│
packages/core/src/api/
│   └── server.ts             + GET /api/profile-card (SVG)
│
packages/cli/src/commands/
│   └── card-cmd.ts           ekh card [-o output.svg]
```

### 1.2 Data Flow

```
[모션 제어]
  웹캠 → MediaPipe Hands → 21 landmarks (30fps)
    → gesture-detector → { type, delta, scale, confidence }
    → useMotion → OrbitControls.setAzimuthalAngle/setPolarAngle/dolly
    ↕ 폴백: 마우스 OrbitControls (모션 OFF 시)

[별자리 뷰]
  줌아웃 (camera.distance > 500)
    → ConstellationView 활성화
    → constellation.ts: 각 클러스터 노드 → MST → 별자리 라인
    → 3D Text 라벨 (클러스터명)
  줌인 (camera.distance < 300)
    → ConstellationView 비활성화 (기존 노드 뷰)

[프로필 카드]
  GET /api/profile-card
    → Store.getStats() + getTopics() + clusters
    → profile-card.ts: SVG 문자열 생성
    → 응답 (Content-Type: image/svg+xml)
```

---

## 2. Gesture Detection

### 2.1 Hand Landmarks → Gesture

```typescript
// gesture-detector.ts
type GestureType = 'rotate' | 'pan' | 'zoom' | 'select' | 'reset' | 'none';

interface GestureResult {
  type: GestureType;
  confidence: number;      // 0~1
  position: { x: number; y: number };  // 정규화 (0~1)
  delta: { x: number; y: number };     // 이전 프레임 대비 이동
  pinchDistance?: number;  // 핀치 시 엄지-검지 거리
}

// 제스처 판별 로직
function detectGesture(landmarks: HandLandmark[]): GestureResult {
  const fingers = countExtendedFingers(landmarks);
  const thumbIndexDist = distance(landmarks[4], landmarks[8]);
  const palmCenter = average(landmarks[0], landmarks[5], landmarks[17]);

  if (fingers === 5) return { type: 'rotate', ... };     // ✋ 펼친 손
  if (fingers === 0) return { type: 'pan', ... };         // ✊ 주먹
  if (thumbIndexDist < 0.05) return { type: 'zoom', ... }; // 🤏 핀치
  if (fingers === 1 && isIndexExtended(landmarks))
    return { type: 'select', ... };                       // 👆 검지
  // 👋 흔들기: 3프레임 연속 x방향 왕복
  if (isWaving(history)) return { type: 'reset', ... };

  return { type: 'none', confidence: 0, ... };
}
```

### 2.2 안정화 (3-frame consensus)

```
제스처 변경은 3프레임 연속 동일해야 확정
→ 오인식 (주먹↔핀치) 방지
→ confidence < 0.7인 프레임은 무시
```

### 2.3 제스처 → OrbitControls 매핑

| Gesture | Action | 구현 |
|---------|--------|------|
| ✋ rotate | 회전 | `controls.setAzimuthalAngle += delta.x * sensitivity` |
| ✊ pan | 이동 | `controls.target += delta * panSpeed` |
| 🤏 zoom | 줌 | `camera.position.z += pinchDelta * zoomSpeed` |
| 👆 select | 노드 선택 | 검지 좌표 → raycaster → 가장 가까운 노드 |
| 👋 reset | 초기화 | `camera.position = initialPosition` |

---

## 3. Constellation View

### 3.1 MST 별자리 생성

```typescript
// constellation.ts
interface ConstellationLine {
  from: [number, number, number];
  to: [number, number, number];
  clusterId: number;
}

function buildConstellations(
  nodes: GraphNode[],
  clusters: Cluster[],
): ConstellationLine[] {
  const lines: ConstellationLine[] = [];

  for (const cluster of clusters) {
    const clusterNodes = nodes.filter(n => n.clusterId === cluster.id);
    if (clusterNodes.length < 2) continue;

    // Prim's MST: 클러스터 내 노드를 최소 거리로 연결
    // → 자연스러운 별자리 형태
    const mst = primMST(clusterNodes);
    lines.push(...mst.map(e => ({
      from: e.from.position!,
      to: e.to.position!,
      clusterId: cluster.id,
    })));
  }

  return lines;
}
```

### 3.2 줌레벨 전환

```
distance > 500: 별자리 모드
  - 노드: 작은 별 포인트 (size 1~2)
  - 별자리 라인: 밝은 글로우
  - 라벨: 클러스터명 3D 텍스트
  - 엣지: 숨김

300 < distance < 500: 전환 구간
  - 별자리 라인 opacity 페이드
  - 노드 크기 점진적 증가
  - 라벨 opacity 페이드

distance < 300: 노드 모드
  - 기존 Phase 2 뷰 (노드 + 엣지)
  - 별자리 라인/라벨 숨김
```

---

## 4. Profile Card (SVG)

### 4.1 카드 레이아웃

```
┌──────────────────────────────────────────┐
│  🧠 Evan's Knowledge Universe            │
│  1,512 documents · 10 clusters · 5,258   │
├──────────────────────────────────────────┤
│                                          │
│    ┌─────────────┐  ┌────────────────┐  │
│    │  Radar Chart │  │  Word Cloud    │  │
│    │  (6 clusters)│  │  (top 20 tags) │  │
│    │     ╱╲       │  │  AI  React     │  │
│    │   ╱    ╲     │  │ OAuth Pattern  │  │
│    │  ╱──────╲    │  │  Deploy Auth   │  │
│    └─────────────┘  └────────────────┘  │
│                                          │
│  Generated by Evan Knowledge Hub         │
└──────────────────────────────────────────┘
```

### 4.2 API

```
GET /api/profile-card
  → Content-Type: image/svg+xml
  → 800x400 SVG
  → 다크 테마 (우주 배경)
  → 레이더 차트: 상위 6 클러스터 비율
  → 워드클라우드: 상위 20 태그 (크기 = 빈도)
```

---

## 5. Dependencies (Phase 2.5 추가)

| Package | Version | Purpose | Size |
|---------|---------|---------|------|
| `@mediapipe/hands` | ^0.4 | 손 랜드마크 | ~5MB WASM |
| `@mediapipe/camera_utils` | ^0.3 | 웹캠 스트림 | 작음 |
| `@mediapipe/drawing_utils` | ^0.3 | 미리보기 시각화 | 작음 |

프로필 카드는 순수 문자열 조합 (SVG 템플릿), 추가 의존성 없음.

---

## 6. Test Plan

| Type | File | Tests | Priority |
|------|------|-------|:--------:|
| Unit | `gesture-detector.test.ts` | 6개 제스처 분류, confidence 검증 | P0 |
| Unit | `constellation.test.ts` | MST 계산, 빈 클러스터 처리 | P0 |
| Unit | `profile-card.test.ts` | SVG 생성, 데이터 바인딩 | P1 |
| Integration | `api-card.test.ts` | GET /api/profile-card 응답 | P1 |
| E2E | 수동 | 웹캠 → 제스처 → 그래프 반응 | P0 |

---

## 7. Implementation Guide

### 7.1 File Structure (신규 파일만)

```
packages/graph/src/
├── lib/
│   ├── motion-controller.ts    [NEW]
│   ├── gesture-detector.ts     [NEW]
│   ├── constellation.ts        [NEW]
│   └── profile-card.ts         [NEW]
├── components/
│   ├── MotionOverlay.tsx       [NEW]
│   ├── MotionToggle.tsx        [NEW]
│   └── ConstellationView.tsx   [NEW]
├── hooks/
│   └── useMotion.ts            [NEW]

packages/core/src/api/
│   └── server.ts               [MODIFY] + /api/profile-card

packages/cli/src/commands/
│   └── card-cmd.ts             [NEW]
│   └── index.ts                [MODIFY] + card command
```

### 7.2 Module Map

| Module | Scope Key | Description | Effort |
|--------|-----------|-------------|:------:|
| MediaPipe 모션 | `module-1` | motion-controller + gesture-detector + useMotion | Large |
| 모션 UI | `module-2` | MotionOverlay PIP + MotionToggle + Graph3D 통합 | Small |
| 별자리 뷰 | `module-3` | constellation.ts + ConstellationView + 줌 전환 | Medium |
| 프로필 카드 | `module-4` | profile-card SVG + API + CLI + 테스트 | Medium |

### 7.3 Session Guide

| Session | Scope | 내용 | 산출물 |
|---------|-------|------|--------|
| **Session 1** | `module-1,module-2` | 모션 제어 전체 | 손으로 그래프 조작 |
| **Session 2** | `module-3` | 별자리 뷰 | 줌아웃→별자리, 줌인→노드 |
| **Session 3** | `module-4` | 프로필 카드 + 테스트 | SVG 카드 + `ekh card` |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-30 | Initial Phase 2.5 Design — Option C (Pragmatic) | Evan (KHS) |
