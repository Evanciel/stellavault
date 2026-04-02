# Phase 4a: Open Source Launch — Design Document

> **Summary**: 3D 그래프 스크린샷/녹화 내보내기 + 별자리 LOD 고도화 상세 설계
>
> **Project**: evan-knowledge-hub
> **Version**: 0.4.0-alpha
> **Author**: Evan (KHS)
> **Date**: 2026-03-31
> **Status**: Draft
> **Planning Doc**: [core.plan.md](../../01-plan/features/core.plan.md)
> **Architecture**: Option C — Pragmatic Balance

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 완성된 프로젝트의 "첫인상" 준비. 시각적 임팩트가 오픈소스 초기 관심 핵심 |
| **WHO** | Claude Code + Obsidian 개발자, 테크 블로거/크리에이터 |
| **RISK** | WebGL canvas 캡처 품질, 별자리 LOD 전환 UX 끊김 |
| **SUCCESS** | PNG < 2초, 별자리 줌 3단계 부드러운 전환, Quick Start 5분 이내 |
| **SCOPE** | Phase 4a (4주). npm publish 미포함 |

---

## 1. Overview

Phase 4a는 두 가지 핵심 모듈로 구성:

1. **Export 모듈**: 3D 그래프를 PNG 스크린샷 / WebM 녹화로 내보내기
2. **Constellation LOD 모듈**: 줌 레벨에 따른 3단계 추상화 전환

기존 코드 기반:
- `Graph3D.tsx`: `preserveDrawingBuffer: true` 이미 설정 → canvas 캡처 가능
- `ConstellationView.tsx`: 카메라 거리 기반 opacity 조절 로직 존재 (300~500 범위)
- `graph-store.ts`: Zustand store, 현재 12개 상태 + 11개 액션

---

## 2. Architecture (Option C — Pragmatic Balance)

### 2.1 파일 구조

```
packages/graph/src/
├── components/
│   ├── ExportPanel.tsx          [NEW] 내보내기 UI 패널
│   ├── Graph3D.tsx              [MOD] canvasRef 전달 + ExportPanel 통합
│   ├── ConstellationView.tsx    [MOD] LOD hook 사용으로 리팩토링
│   └── ... (기존 유지)
├── hooks/
│   ├── useExport.ts             [NEW] PNG/WebM 캡처 로직
│   ├── useConstellationLOD.ts   [NEW] 카메라 거리 → 3단계 LOD 레벨
│   └── ... (기존 유지)
├── lib/
│   └── export-utils.ts          [NEW] PNG/WebM 변환 유틸리티
├── stores/
│   └── graph-store.ts           [MOD] export/LOD 상태 추가
└── ... (기존 유지)
```

### 2.2 의존성 관계

```
ExportPanel.tsx
  └── useExport.ts (hook)
        └── export-utils.ts (pure functions)
              └── canvas.toDataURL() / MediaRecorder API

ConstellationView.tsx
  └── useConstellationLOD.ts (hook)
        └── camera.position.length() → lodLevel 계산
              └── graph-store.ts (lodLevel 상태)
```

---

## 3. Data Model

### 3.1 graph-store 확장

```typescript
// 추가될 상태 (기존 GraphState에 merge)
interface ExportState {
  isExporting: boolean;        // 내보내기 진행 중
  isRecording: boolean;        // WebM 녹화 중
  lodLevel: 'universe' | 'constellation' | 'note';  // 현재 LOD 레벨
}

// 추가될 액션
interface ExportActions {
  setExporting: (v: boolean) => void;
  setRecording: (v: boolean) => void;
  setLodLevel: (level: 'universe' | 'constellation' | 'note') => void;
}
```

### 3.2 LOD 레벨 정의

| Level | Camera Distance | 표시 내용 | 노드 크기 |
|-------|:--------------:|----------|:--------:|
| `universe` | > 800 | 별자리 라인 + 클러스터 레이블만 | 1x (점) |
| `constellation` | 300~800 | 별자리 라인 + 레이블 + 노드 점 | 2x |
| `note` | < 300 | 개별 노드 + 엣지 + 노드 라벨 | 3x |

전환 시 opacity를 lerp하여 부드러운 페이드 인/아웃 (기존 ConstellationView 패턴 확장).

---

## 4. Component Design

### 4.1 ExportPanel

```
┌─────────────────────────────┐
│ 📸 Export                    │
├─────────────────────────────┤
│ Resolution: [1024▾] [2048]  │
│ Background: [●Dark] [○Trans]│
│ Watermark:  [✓] ekh         │
│                             │
│ [📷 Screenshot]  [🎬 Record]│
│                             │
│ (Recording... 3.2s) [⏹ Stop]│
└─────────────────────────────┘
```

**위치**: Layout.tsx 우측 하단, StatusBar 위
**토글**: 카메라 아이콘 버튼 (항상 노출)

**Props & State**:
```typescript
// useExport hook이 모든 로직 관리
interface UseExportReturn {
  // 스크린샷
  takeScreenshot: (options: ScreenshotOptions) => Promise<void>;
  // 녹화
  startRecording: (options: RecordingOptions) => void;
  stopRecording: () => Promise<Blob>;
  // 상태
  isExporting: boolean;
  isRecording: boolean;
  recordingDuration: number;
}

interface ScreenshotOptions {
  width: number;       // default: 2048
  height: number;      // default: 2048
  transparent: boolean; // default: false
  watermark: boolean;   // default: true
}

interface RecordingOptions {
  duration: number;     // max seconds, default: 5
  fps: number;          // default: 60
  rotation: boolean;    // auto-rotate during recording, default: true
}
```

### 4.2 ConstellationView (LOD 확장)

기존 ConstellationView를 LOD 레벨에 따라 동작 변경:

```typescript
// useConstellationLOD hook
interface UseConstellationLODReturn {
  lodLevel: 'universe' | 'constellation' | 'note';
  constellationOpacity: number;  // 0~1, lerp
  nodeScale: number;             // LOD에 따른 노드 스케일
  showLabels: boolean;           // 별자리 레이블 표시 여부
  showEdges: boolean;            // 엣지 표시 여부
}
```

**LOD 전환 로직** (useFrame 내부):
```
camera.distance > 800 → universe:
  - 별자리 라인 opacity: 0.5
  - 노드: 작은 점 (size 1)
  - 엣지: 숨김
  - 레이블: 클러스터명만 (큰 폰트)

camera.distance 300~800 → constellation:
  - 별자리 라인 opacity: 0.3 (fade)
  - 노드: 중간 크기 (size 2)
  - 엣지: 약하게 표시
  - 레이블: 클러스터명 + 노트 수

camera.distance < 300 → note:
  - 별자리 라인: 숨김
  - 노드: 기존 크기 (size 3)
  - 엣지: 정상 표시
  - 레이블: 개별 노트 제목 (hover 시)
```

**전환 애니메이션**: 기존 `opacityRef.current += (target - current) * 0.05` 패턴 재사용.

---

## 5. Hook Design

### 5.1 useExport

```typescript
// Design Ref: §5.1 — 스크린샷/녹화 로직 분리
export function useExport(canvasRef: RefObject<HTMLCanvasElement>) {
  // PNG 스크린샷
  async function takeScreenshot(options: ScreenshotOptions): Promise<void> {
    // 1. canvas 크기 임시 조정 (고해상도)
    // 2. 1프레임 렌더 대기
    // 3. canvas.toDataURL('image/png')
    // 4. <a download> 트리거
    // 5. 워터마크 추가 (옵션)
    // 6. canvas 크기 원복
  }

  // WebM 녹화
  function startRecording(options: RecordingOptions): void {
    // 1. canvas.captureStream(fps)
    // 2. new MediaRecorder(stream, { mimeType: 'video/webm' })
    // 3. 자동 회전 시작 (옵션)
    // 4. duration 후 자동 정지
  }

  async function stopRecording(): Promise<Blob> {
    // 1. recorder.stop()
    // 2. chunks → Blob
    // 3. URL.createObjectURL → <a download>
    // 4. 자동 회전 중지
  }
}
```

**핵심 구현 포인트**:
- `preserveDrawingBuffer: true`가 이미 설정됨 → `toDataURL()` 직접 사용 가능
- 고해상도 캡처: canvas 크기를 임시로 2048x2048로 변경 → 렌더 → 캡처 → 원복
- WebM: `MediaRecorder` + `canvas.captureStream()` 조합
- Safari fallback: `MediaRecorder` 미지원 시 PNG 시퀀스 (alert 안내)

### 5.2 useConstellationLOD

```typescript
// Design Ref: §5.2 — 카메라 거리 기반 LOD 레벨 결정
export function useConstellationLOD() {
  // useFrame에서 매 프레임 camera.position.length() 체크
  // 거리에 따라 lodLevel 결정
  // opacity/scale을 lerp로 부드럽게 전환
  // graph-store에 lodLevel 업데이트 (변경 시에만)

  // 반환: { lodLevel, constellationOpacity, nodeScale, showLabels, showEdges }
}
```

**임계값 설정**:
```typescript
const LOD_THRESHOLDS = {
  UNIVERSE_MIN: 800,     // 이 이상이면 universe
  NOTE_MAX: 300,          // 이 이하면 note
  // 300~800 사이는 constellation
  LERP_SPEED: 0.05,       // 기존 ConstellationView와 동일한 전환 속도
} as const;
```

---

## 6. lib/export-utils.ts

순수 함수 모듈. DOM/Three.js에 의존하지 않는 유틸리티:

```typescript
// 워터마크 추가
export function addWatermark(
  imageData: ImageData,
  text: string,
  position: 'bottom-right' | 'bottom-left'
): ImageData;

// canvas를 고해상도 PNG Blob으로 변환
export function canvasToPngBlob(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): Promise<Blob>;

// Blob을 파일로 다운로드
export function downloadBlob(blob: Blob, filename: string): void;

// 녹화용 파일명 생성
export function generateFilename(
  type: 'screenshot' | 'recording',
  extension: string
): string;
// → "ekh-knowledge-2026-03-31-143022.png"
```

---

## 7. Graph3D.tsx 수정사항

```diff
  export function Graph3D() {
+   const canvasRef = useRef<HTMLCanvasElement>(null);
    // ...
    return (
-     <Canvas
+     <Canvas ref={canvasRef}
        camera={{ position: [0, 100, 600], fov: 55, near: 1, far: 5000 }}
        // ...
      >
        <Scene />
      </Canvas>
+     <ExportPanel canvasRef={canvasRef} />
    );
  }
```

**주의**: `<ExportPanel>`은 Canvas 외부에 위치 (HTML overlay). Canvas 내부가 아닌 sibling으로 배치.

---

## 8. ConstellationView.tsx 수정사항

기존 300~500 범위의 opacity 로직을 `useConstellationLOD` 훅으로 대체:

```diff
  export function ConstellationView() {
+   const { lodLevel, constellationOpacity, showLabels } = useConstellationLOD();
    // ...
    useFrame(({ camera }) => {
-     const dist = camera.position.length();
-     let targetOpacity = 0;
-     if (dist > 500) targetOpacity = 1;
-     else if (dist > 300) targetOpacity = (dist - 300) / 200;
+     // LOD hook이 opacity를 관리
+     const opacity = constellationOpacity;
      // ... (나머지 로직 동일)
    });
  }
```

GraphNodes에도 LOD 레벨에 따른 노드 스케일 조정 필요:
- `useConstellationLOD`의 `nodeScale`을 GraphNodes에서 참조
- LOD `universe`에서는 노드를 더 작게, `note`에서는 기존 크기

---

## 9. Layout.tsx 통합

ExportPanel 토글 버튼을 StatusBar 영역에 추가:

```
┌──────────────────────────────────────────┐
│ SearchBar                                │
├──────────────────────────────────────────┤
│                                          │
│            3D Graph Canvas               │
│                                          │
├──────────────────────────────────────────┤
│ StatusBar          [Theme] [📷Export]     │
└──────────────────────────────────────────┘
              ↕ (토글 시)
┌──────────────────────────────────────────┐
│ ExportPanel (오버레이)                    │
└──────────────────────────────────────────┘
```

---

## 10. Error Handling

| 시나리오 | 처리 |
|---------|------|
| canvas.toDataURL() 실패 (보안 제한) | try/catch → "스크린샷 불가" toast |
| MediaRecorder 미지원 (Safari) | feature detection → "WebM 녹화는 Chrome/Firefox에서 사용 가능" 안내 |
| 녹화 중 탭 전환 | visibilitychange 이벤트 → 자동 정지 |
| 고해상도 캡처 시 메모리 부족 | 4096 이상 요청 시 2048로 자동 제한 |
| LOD 전환 중 노드 클릭 | lodLevel 변경이 클릭 이벤트를 방해하지 않도록 별도 처리 |

---

## 11. Implementation Guide

### 11.1 구현 순서

| # | 모듈 | 파일 | 의존성 |
|---|------|------|--------|
| 1 | graph-store 확장 | `stores/graph-store.ts` | 없음 |
| 2 | export-utils | `lib/export-utils.ts` | 없음 |
| 3 | useExport hook | `hooks/useExport.ts` | export-utils |
| 4 | ExportPanel | `components/ExportPanel.tsx` | useExport, graph-store |
| 5 | Graph3D 수정 | `components/Graph3D.tsx` | ExportPanel |
| 6 | useConstellationLOD hook | `hooks/useConstellationLOD.ts` | graph-store |
| 7 | ConstellationView 수정 | `components/ConstellationView.tsx` | useConstellationLOD |
| 8 | GraphNodes LOD 연동 | `components/GraphNodes.tsx` | useConstellationLOD |
| 9 | 테스트 작성 | `tests/` | 모든 모듈 |
| 10 | 문서 정비 | `README.md`, `CONTRIBUTING.md`, etc. | 없음 |

### 11.2 테스트 계획

| 테스트 | 타입 | 파일 |
|--------|------|------|
| export-utils 순수 함수 | Unit | `tests/export-utils.test.ts` |
| useConstellationLOD 임계값 | Unit | `tests/constellation-lod.test.ts` |
| PNG 스크린샷 생성 | Integration | `tests/export.test.ts` |
| LOD 레벨 전환 | Unit | `tests/constellation-lod.test.ts` |
| graph-store 신규 상태 | Unit | `tests/graph-store-export.test.ts` |

### 11.3 Session Guide

| Session | Module Key | 파일 | 예상 작업량 |
|---------|-----------|------|-----------|
| **session-1** | Export 코어 | graph-store 확장 + export-utils + useExport + ExportPanel + Graph3D 수정 | ~350 lines |
| **session-2** | Constellation LOD | useConstellationLOD + ConstellationView 수정 + GraphNodes LOD | ~200 lines |
| **session-3** | 테스트 + 문서 | 테스트 5개 + README + CONTRIBUTING + LICENSE + .env.example | ~400 lines |

**Module Map**:
```
session-1: Export (구현 #1~5)
session-2: Constellation LOD (구현 #6~8)
session-3: Tests & Docs (구현 #9~10)
```

Session 1과 2는 독립적 — 병렬 가능.
Session 3은 1+2 완료 후.

---

## 12. Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-31 | Initial design — Option C (Pragmatic) | Evan (KHS) |
