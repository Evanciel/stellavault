// Capture orchestration types. The IPC-facing shapes (CaptureKind/Source/Stage/Request/
// Outcome) live in shared/ipc-types.ts — single source of truth across main + renderer —
// and are re-exported here for the engine + queue DAO. QueueStatus/QueueItem are
// main-process internal (the persisted queue row). Design Ref: §6.1.

export type {
  CaptureKind, CaptureSource, CaptureStage, CaptureRequest, CaptureOutcome,
} from '../../shared/ipc-types.js';

import type { CaptureRequest, CaptureOutcome } from '../../shared/ipc-types.js';

export type QueueStatus = 'queued' | 'processing' | 'done' | 'rejected' | 'duplicate';

export interface QueueItem extends CaptureRequest {
  id: string;
  status: QueueStatus;
  result?: CaptureOutcome;
  enqueuedAt: string;
  updatedAt: string;
}
