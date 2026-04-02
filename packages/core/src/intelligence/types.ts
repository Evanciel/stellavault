// Design Ref: §2.2 — FSRS 감쇠 타입 정의

export interface DecayState {
  documentId: string;
  stability: number;      // days until R drops to 0.9
  difficulty: number;      // 1~10
  lastAccess: string;      // ISO timestamp
  retrievability: number;  // 0~1 (computed)
}

export interface AccessEvent {
  documentId: string;
  type: 'view' | 'search' | 'mcp_query';
  timestamp: string;
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
