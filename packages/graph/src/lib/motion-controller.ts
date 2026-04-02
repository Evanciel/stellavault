// Design Ref: §2 — MediaPipe Hands 초기화 + 웹캠 관리

import { detectGesture, resetGestureState, type GestureResult } from './gesture-detector.js';

export interface MotionController {
  start(): Promise<void>;
  stop(): void;
  isRunning(): boolean;
  getVideoElement(): HTMLVideoElement | null;
  onGesture(cb: (gesture: GestureResult) => void): void;
}

export function createMotionController(): MotionController {
  let video: HTMLVideoElement | null = null;
  let hands: any = null;
  let camera: any = null;
  let running = false;
  let gestureCallback: ((g: GestureResult) => void) | null = null;

  return {
    async start() {
      if (running) return;

      // 동적 import (lazy load — ~5MB WASM)
      const [handsModule, cameraModule] = await Promise.all([
        import('@mediapipe/hands'),
        import('@mediapipe/camera_utils'),
      ]);

      // 비디오 요소 생성
      video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.style.display = 'none';
      document.body.appendChild(video);

      // MediaPipe Hands 초기화
      hands = new handsModule.Hands({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0, // 0=lite (가장 빠름)
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });

      hands.onResults((results: any) => {
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          const gesture = detectGesture(results.multiHandLandmarks[0]);
          if (gesture.type !== 'none' && gestureCallback) {
            gestureCallback(gesture);
          }
        }
      });

      // 카메라 시작
      camera = new cameraModule.Camera(video, {
        onFrame: async () => {
          if (hands && video) await hands.send({ image: video });
        },
        width: 320,
        height: 240,
      });

      await camera.start();
      running = true;
      resetGestureState();
    },

    stop() {
      if (camera) { camera.stop(); camera = null; }
      if (hands) { hands.close(); hands = null; }
      if (video) { video.remove(); video = null; }
      running = false;
      resetGestureState();
    },

    isRunning() { return running; },
    getVideoElement() { return video; },
    onGesture(cb) { gestureCallback = cb; },
  };
}
