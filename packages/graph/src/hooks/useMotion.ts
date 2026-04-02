// Design Ref: §2.3 — 제스처 → OrbitControls 매핑

import { useRef, useCallback, useEffect } from 'react';
import { createMotionController, type MotionController } from '../lib/motion-controller.js';
import type { GestureResult } from '../lib/gesture-detector.js';
import { useGraphStore } from '../stores/graph-store.js';

export interface UseMotionReturn {
  start: () => Promise<void>;
  stop: () => void;
  isActive: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  currentGesture: React.RefObject<string>;
}

export function useMotion(controlsRef: React.RefObject<any>): UseMotionReturn {
  const controllerRef = useRef<MotionController | null>(null);
  const activeRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const currentGesture = useRef<string>('none');
  const initialZoomRef = useRef<number | null>(null);
  const pinchBaseRef = useRef<number>(0);

  const handleGesture = useCallback((gesture: GestureResult) => {
    const controls = controlsRef.current;
    if (!controls) return;

    currentGesture.current = gesture.type;
    const sensitivity = 3;

    switch (gesture.type) {
      case 'rotate':
        // 손 이동 → 회전
        controls.setAzimuthalAngle(
          controls.getAzimuthalAngle() - gesture.delta.x * sensitivity
        );
        controls.setPolarAngle(
          Math.max(0.1, Math.min(Math.PI - 0.1,
            controls.getPolarAngle() + gesture.delta.y * sensitivity
          ))
        );
        controls.update();
        break;

      case 'pan': {
        // 주먹 이동 → 패닝
        const target = controls.target;
        target.x -= gesture.delta.x * 500;
        target.y += gesture.delta.y * 500;
        controls.update();
        break;
      }

      case 'zoom': {
        // 핀치 거리 → 줌
        if (pinchBaseRef.current === 0) pinchBaseRef.current = gesture.pinchDistance;
        const zoomDelta = (gesture.pinchDistance - pinchBaseRef.current) * 2000;
        const cam = controls.object;
        if (cam) {
          const dir = cam.position.clone().sub(controls.target).normalize();
          cam.position.addScaledVector(dir, -zoomDelta);
          pinchBaseRef.current = gesture.pinchDistance;
        }
        controls.update();
        break;
      }

      case 'select': {
        // 검지 포인팅 → 노드 호버 (화면 좌표로 변환)
        // 간단 구현: 검지 위치를 hoveredNodeId로 매핑 (향후 raycast 개선)
        break;
      }

      case 'reset': {
        // 손 흔들기 → 초기 위치
        const cam = controls.object;
        if (cam) {
          cam.position.set(0, 100, 600);
          controls.target.set(0, 0, 0);
          controls.update();
        }
        const state = useGraphStore.getState();
        state.selectNode(null);
        state.setHighlightedNodes([]);
        break;
      }
    }

    // 핀치 외 제스처에서 pinchBase 리셋
    if (gesture.type !== 'zoom') pinchBaseRef.current = 0;
  }, [controlsRef]);

  const start = useCallback(async () => {
    if (!controllerRef.current) {
      controllerRef.current = createMotionController();
    }
    controllerRef.current.onGesture(handleGesture);
    await controllerRef.current.start();
    videoRef.current = controllerRef.current.getVideoElement();
    activeRef.current = true;
  }, [handleGesture]);

  const stop = useCallback(() => {
    controllerRef.current?.stop();
    activeRef.current = false;
    videoRef.current = null;
    currentGesture.current = 'none';
  }, []);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => () => { controllerRef.current?.stop(); }, []);

  return {
    start,
    stop,
    get isActive() { return activeRef.current; },
    videoRef,
    currentGesture,
  };
}
