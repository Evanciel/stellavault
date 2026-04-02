// Design Ref: §6 — PNG/WebM 변환 유틸리티 (순수 함수)

export function generateFilename(type: 'screenshot' | 'recording', extension: string): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `stellavault-${type}-${ts}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function addWatermark(
  canvas: HTMLCanvasElement,
  text: string,
): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.save();
  ctx.font = '14px monospace';
  ctx.fillStyle = 'rgba(200, 200, 255, 0.4)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, canvas.width - 16, canvas.height - 12);
  ctx.restore();

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create blob from canvas'));
    }, 'image/png');
  });
}

export function isMediaRecorderSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' &&
    MediaRecorder.isTypeSupported('video/webm');
}
