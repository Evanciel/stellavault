// 웹캠 PIP 미리보기 + 현재 제스처 상태 표시

import { useEffect, useRef } from 'react';

const GESTURE_LABELS: Record<string, string> = {
  rotate: '✋ Rotate',
  pan: '✊ Pan',
  zoom: '🤏 Zoom',
  select: '👆 Select',
  reset: '👋 Reset',
  none: '...',
};

interface Props {
  videoElement: HTMLVideoElement | null;
  currentGesture: React.RefObject<string>;
}

export function MotionOverlay({ videoElement, currentGesture }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!videoElement || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    function draw() {
      if (!videoElement || !ctx) return;
      ctx.save();
      // 좌우 반전 (거울 모드)
      ctx.scale(-1, 1);
      ctx.drawImage(videoElement, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();

      // 제스처 라벨 업데이트
      if (labelRef.current) {
        const g = currentGesture.current ?? 'none';
        labelRef.current.textContent = GESTURE_LABELS[g] ?? g;
      }

      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, [videoElement, currentGesture]);

  if (!videoElement) return null;

  return (
    <div style={{
      position: 'absolute', bottom: '16px', right: '16px',
      borderRadius: '12px', overflow: 'hidden',
      border: '1px solid rgba(100, 120, 255, 0.3)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      zIndex: 50,
    }}>
      <canvas
        ref={canvasRef}
        width={192}
        height={144}
        style={{ display: 'block', background: '#111' }}
      />
      <div
        ref={labelRef}
        style={{
          position: 'absolute', bottom: '6px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', padding: '2px 10px', borderRadius: '10px',
          fontSize: '11px', color: '#88aaff', whiteSpace: 'nowrap',
        }}
      >
        ...
      </div>
    </div>
  );
}
