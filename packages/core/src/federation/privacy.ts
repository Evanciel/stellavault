// Federation Phase 2: Differential Privacy
// 임베딩 벡터에 노이즈를 추가하여 원문 복원 방지

import { randomBytes } from 'node:crypto';

export interface DPConfig {
  epsilon: number;    // 프라이버시 예산 (낮을수록 더 안전, 기본 1.0)
  enabled: boolean;
}

const DEFAULT_DP: DPConfig = { epsilon: 1.0, enabled: true };

// 가우시안 노이즈 생성 (Box-Muller 변환)
function gaussianNoise(): number {
  const u1 = Math.max(1e-10, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// 임베딩 벡터에 Differential Privacy 노이즈 추가
export function addDPNoise(embedding: number[], config: DPConfig = DEFAULT_DP): number[] {
  if (!config.enabled) return embedding;

  const sensitivity = 1.0; // L2 sensitivity (normalized embeddings)
  const sigma = sensitivity / config.epsilon;

  return embedding.map(v => v + gaussianNoise() * sigma);
}

// 노이즈 추가 후 L2 정규화 (코사인 유사도 유지)
export function addDPNoiseNormalized(embedding: number[], config: DPConfig = DEFAULT_DP): number[] {
  const noisy = addDPNoise(embedding, config);

  // L2 정규화
  let norm = 0;
  for (const v of noisy) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return noisy;

  return noisy.map(v => v / norm);
}

// 스니펫에 DP 적용 (단어 단위 마스킹)
export function maskSnippet(snippet: string, maskRate = 0.3): string {
  const words = snippet.split(/\s+/);
  return words.map(w => {
    if (Math.random() < maskRate && w.length > 2) {
      return w[0] + '***';
    }
    return w;
  }).join(' ');
}
