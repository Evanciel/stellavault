// Design Ref: §5.1 — 스크린샷/녹화 로직
// Plan SC: SC-01 (PNG 캡처), SC-02 (WebM 녹화)

import { useRef, useState, useCallback } from 'react';
import { useGraphStore } from '../stores/graph-store.js';
import {
  generateFilename,
  downloadBlob,
  addWatermark,
  canvasToBlob,
  isMediaRecorderSupported,
} from '../lib/export-utils.js';

export interface ScreenshotOptions {
  watermark?: boolean;
  width?: number;   // default: canvas width (max 4096)
  height?: number;  // default: canvas height (max 4096)
}

export interface RecordingOptions {
  duration?: number;   // seconds, default 5
  rotation?: boolean;  // auto-rotate, default true
}

export function useExport() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const startTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number>(0);

  const getCanvas = useCallback((): HTMLCanvasElement | null => {
    return document.querySelector('canvas');
  }, []);

  const takeScreenshot = useCallback(async (options: ScreenshotOptions = {}) => {
    const canvas = getCanvas();
    if (!canvas) return;

    const store = useGraphStore.getState();
    store.setExporting(true);

    try {
      // High-res capture: resize canvas temporarily if requested
      const targetW = Math.min(options.width ?? canvas.width, 4096);
      const targetH = Math.min(options.height ?? canvas.height, 4096);
      const origW = canvas.width;
      const origH = canvas.height;
      const needsResize = targetW !== origW || targetH !== origH;

      if (needsResize) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = origW + 'px';
        canvas.style.height = origH + 'px';
        // Force one frame render at new resolution
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }

      const offscreen = document.createElement('canvas');
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(canvas, 0, 0);

      if (needsResize) {
        canvas.width = origW;
        canvas.height = origH;
        canvas.style.width = '';
        canvas.style.height = '';
      }

      if (options.watermark !== false) {
        addWatermark(offscreen, 'Stellavault');
      }

      const blob = await canvasToBlob(offscreen);
      downloadBlob(blob, generateFilename('screenshot', 'png'));
    } catch (err) {
      console.error('Screenshot failed:', err);
    } finally {
      store.setExporting(false);
    }
  }, [getCanvas]);

  const startRecording = useCallback((options: RecordingOptions = {}) => {
    const canvas = getCanvas();
    if (!canvas || !isMediaRecorderSupported()) {
      console.error('WebM recording is not supported in this browser');
      return;
    }

    const store = useGraphStore.getState();
    const duration = options.duration ?? 5;
    const rotation = options.rotation ?? true;

    // Start auto-rotation if requested
    if (rotation) {
      const controls = (window as any).__sv_controls?.current;
      if (controls) {
        (window as any).__sv_autoRotate = true;
      }
    }

    const stream = canvas.captureStream(60);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 8_000_000,
    });

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      downloadBlob(blob, generateFilename('recording', 'webm'));
      chunksRef.current = [];
      store.setRecording(false);
      (window as any).__sv_autoRotate = false;

      if (timerRef.current) cancelAnimationFrame(timerRef.current);
      setRecordingDuration(0);
    };

    recorderRef.current = recorder;
    recorder.start();
    store.setRecording(true);
    startTimeRef.current = performance.now();

    // Duration timer with RAF
    function updateTimer() {
      const elapsed = (performance.now() - startTimeRef.current) / 1000;
      setRecordingDuration(elapsed);
      if (elapsed >= duration) {
        stopRecording();
        return;
      }
      timerRef.current = requestAnimationFrame(updateTimer);
    }
    timerRef.current = requestAnimationFrame(updateTimer);
  }, [getCanvas]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
    if (timerRef.current) {
      cancelAnimationFrame(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    takeScreenshot,
    startRecording,
    stopRecording,
    recordingDuration,
    isMediaRecorderSupported: isMediaRecorderSupported(),
  };
}
