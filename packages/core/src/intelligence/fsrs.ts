// Design Ref: §1 — FSRS-6 알고리즘 (순수 함수)
// Plan SC: SC-01 (R값 계산), SC-02 (stability 업데이트)

/**
 * FSRS parameters tuned for knowledge notes (not flashcards).
 * Knowledge notes have longer natural retention than flashcards.
 */
export const FSRS_PARAMS = {
  initialStability: 7.0,  // 7 days for new notes
  difficulty: 5.0,         // default difficulty (1~10)
  // Stability growth factors
  a: 0.4,
  b: 0.6,
  c: 0.2,
  d: 1.0,
  // Stability bonus for large/connected notes
  sizeFactor: 0.5,        // additional days per 1000 chars
  connectionFactor: 1.0,  // additional days per connection
} as const;

/**
 * Compute retrievability R(t) using FSRS power forgetting curve.
 * R(t) = (1 + t / (9 * S))^(-1)
 *
 * @param stabilityDays - Stability S (days until R drops to ~0.9)
 * @param elapsedDays - Days since last access
 * @returns Retrievability 0~1
 */
export function computeRetrievability(stabilityDays: number, elapsedDays: number): number {
  if (elapsedDays <= 0) return 1.0;
  if (stabilityDays <= 0) return 0.0;
  return Math.pow(1 + elapsedDays / (9 * stabilityDays), -1);
}

/**
 * Update stability after an access event (successful recall).
 * S' = S * (1 + a * D^(-b) * S^(-c) * (e^(d*(1-R)) - 1))
 *
 * @param currentS - Current stability
 * @param difficulty - Note difficulty (1~10)
 * @param currentR - Retrievability at access time
 * @returns New stability (always >= currentS)
 */
export function updateStability(
  currentS: number,
  difficulty: number,
  currentR: number,
): number {
  const { a, b, c, d } = FSRS_PARAMS;
  const growth = a
    * Math.pow(difficulty, -b)
    * Math.pow(currentS, -c)
    * (Math.exp(d * (1 - currentR)) - 1);
  const newS = currentS * (1 + Math.max(0, growth));
  // Cap at 365 days (1 year max stability)
  return Math.min(newS, 365);
}

/**
 * Estimate initial stability based on note characteristics.
 * Longer notes and more connected notes are more stable.
 */
export function estimateInitialStability(
  contentLength: number,
  connectionCount: number,
): number {
  const base = FSRS_PARAMS.initialStability;
  const sizeBonus = Math.min(contentLength / 1000, 10) * FSRS_PARAMS.sizeFactor;
  const connBonus = Math.min(connectionCount, 10) * FSRS_PARAMS.connectionFactor;
  return base + sizeBonus + connBonus;
}

/**
 * Compute elapsed days between two ISO timestamps.
 */
export function elapsedDays(from: string, to: string = new Date().toISOString()): number {
  const msPerDay = 86400000;
  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / msPerDay);
}
