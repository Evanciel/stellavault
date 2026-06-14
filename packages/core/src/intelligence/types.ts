// Design Ref: §2.2 — FSRS 감쇠 타입 정의

export interface DecayState {
  documentId: string;
  stability: number;      // days until R drops to 0.9
  difficulty: number;      // 1~10
  lastAccess: string;      // ISO timestamp
  retrievability: number;  // 0~1 (computed)
}

/**
 * FSRS recall grade (T2-5). 1=Again, 2=Hard, 3=Good, 4=Easy.
 * Omitted → plain open: weak access (legacy behavior, treated like Good but
 * without an explicit recall judgement).
 */
export type ReviewGrade = 1 | 2 | 3 | 4;

export interface AccessEvent {
  documentId: string;
  type: 'view' | 'search' | 'mcp_query';
  timestamp: string;
  /** T2-5 — optional spaced-repetition grade. Branches the stability update:
   *  Again resets stability, Hard/Good/Easy raise it progressively. When omitted,
   *  the access is a plain open (weak access — default legacy update). */
  grade?: ReviewGrade;
}

export interface DecayReport {
  totalDocuments: number;
  decayingCount: number;   // R < 0.5
  criticalCount: number;   // R < 0.3
  averageR: number;
  topDecaying: Array<DecayState & { title: string; daysSinceAccess: number }>;
  clusterHealth: Array<{
    label: string;
    avgR: number;
    count: number;
  }>;
}
