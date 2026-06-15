// OrchestrationEngine — the always-on capture funnel (Design §6.1).
// Serial worker drains the persisted queue; every item flows through runCapture():
//   extract → dedup → ingest(.md) → embed → classify(local) → route(journal) → index → decay.
// Dependency-injected so it stays decoupled from main/index.ts module globals AND so core
// is loaded lazily (main passes the core fns after `await import('@stellavault/core')`).
// I/O-heavy → verified by tsc + Slice-4 integration smoke (pure bits live in capture-helpers).

import { existsSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import type {
  Category, ClassifyConfig, ClassifyResult, IngestInput, IngestResult, NoteCtx, ClassifyDao,
} from '@stellavault/core';
import type { QueueDao } from './queue-dao.js';
import type { CaptureOutcome, CaptureRequest, CaptureStage, QueueItem } from './types.js';
import type { CaptureCounts, CaptureItem, CategoryInfo, ReviewItem } from '../../shared/ipc-types.js';
import { contentHash, incrementalCentroid, ingestTypeFor, sourceLabel } from './capture-helpers.js';

const MAX_FILE = 50 * 1024 * 1024; // 50MB (matches extractFileContent cap)
const MAX_TEXT = 1 * 1024 * 1024;

export interface EngineDeps {
  vaultPath: string;
  queue: QueueDao;
  classifyDao: ClassifyDao;
  cfg: ClassifyConfig;
  ingest: (vaultPath: string, input: IngestInput) => IngestResult;
  extractFile: (path: string) => Promise<{ text: string; title?: string; sourceFormat: string }>;
  classify: (ctx: NoteCtx, cats: Category[], cfg: ClassifyConfig) => ClassifyResult;
  embed: (text: string) => Promise<number[]>;
  indexFile: (absPath: string) => Promise<void>;     // noteSelfWrite + indexFiles + bump caches
  recordCapture: (absPath: string) => void;          // decayEngine.recordAccess(docId, 'capture')
  emit: (channel: string, payload: unknown) => void; // → renderer (BrowserWindow.send)
  isReady: () => boolean;
  now?: () => string;
}

export class OrchestrationEngine {
  private paused = false;
  private draining = false;

  constructor(private readonly deps: EngineDeps) {}

  /** Boot: recover any items stuck mid-process (crash), then drain. */
  start(): void {
    const requeued = this.deps.queue.requeueStuck();
    if (requeued > 0) console.log(`[capture] requeued ${requeued} stuck item(s) on boot`);
    void this.pump();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (!p) void this.pump();
  }
  isPaused(): boolean { return this.paused; }
  depth(): number { return this.deps.queue.depth(); }

  /** Enqueue from any door (drop / MCP / clip). Returns immediately; the worker drains. */
  enqueue(req: CaptureRequest): { id: string } {
    const id = this.deps.queue.enqueue(req);
    this.deps.emit('capture:progress', { id, phase: 'queued' });
    void this.pump();
    return { id };
  }

  // ─── Read / review surface for the IPC handlers (returns wire-safe DTOs only) ───

  listCaptures(limit = 50): CaptureItem[] {
    return this.deps.queue.listRecent(limit).map((q) => ({
      id: q.id, kind: q.kind, title: q.title ?? q.result?.title ?? '(captured)', source: q.source,
      status: q.status, savedTo: q.result?.savedTo, category: q.result?.categories?.[0],
      confidence: q.result?.confidence, decision: q.result?.decision, reason: q.result?.reason,
      enqueuedAt: q.enqueuedAt,
    }));
  }

  listReview(): ReviewItem[] {
    const dao = this.deps.classifyDao;
    return dao.listPendingReview().map((j) => ({
      id: j.id, notePath: j.notePath, title: basename(j.notePath).replace(/\.md$/, ''),
      confidence: j.confidence, stage: j.stage,
      suggestions: j.alternatives.map((a) => ({ id: a.id, label: dao.getCategory(a.id)?.label ?? a.id, sim: a.sim })),
    }));
  }

  listCategories(): CategoryInfo[] {
    return this.deps.classifyDao.listCategories().map((c) => ({
      id: c.id, label: c.label, origin: c.origin, memberCount: c.memberCount, keywords: c.keywords,
    }));
  }

  confirmReview(id: string, categoryId: string | null, stage?: string): void {
    this.deps.classifyDao.updateJournalStatus(id, 'confirmed', { categoryId, stage, decidedBy: 'user' });
    this.emitReviewChanged();
  }

  skipReview(id: string): void {
    this.deps.classifyDao.updateJournalStatus(id, 'skipped', { decidedBy: 'user' });
    this.emitReviewChanged();
  }

  counts(): CaptureCounts {
    return {
      capturedToday: 0, // MVP: refined in P2 (count today's 'done' rows)
      pendingReviewCount: this.deps.classifyDao.listPendingReview().length,
      queueDepth: this.deps.queue.depth(),
      watching: !this.paused,
    };
  }

  private emitReviewChanged(): void {
    this.deps.emit('review:changed', { queueLength: this.deps.classifyDao.listPendingReview().length });
  }

  private nowIso(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  /** Serial worker loop (concurrency 1, re-entrancy guarded). */
  private async pump(): Promise<void> {
    if (this.draining || this.paused) return;
    this.draining = true;
    try {
      for (;;) {
        if (this.paused) break;
        const item = this.deps.queue.nextQueued();
        if (!item) break;
        this.deps.queue.setStatus(item.id, 'processing');
        this.deps.emit('capture:progress', { id: item.id, phase: 'extracting' });

        let outcome: CaptureOutcome;
        try {
          outcome = await this.runCapture(item);
        } catch (err) {
          console.error('[capture] runCapture failed:', err);
          outcome = { status: 'rejected', reason: 'io' };
        }
        const term = outcome.status === 'created' ? 'done' : outcome.status === 'duplicate' ? 'duplicate' : 'rejected';
        this.deps.queue.setStatus(item.id, term, outcome);
        this.deps.emit('capture:done', { id: item.id, ...outcome });
      }
    } finally {
      this.draining = false;
    }
  }

  private async runCapture(item: QueueItem): Promise<CaptureOutcome> {
    if (!this.deps.isReady()) return { status: 'rejected', reason: 'engine-loading' };
    const d = this.deps;

    // 1. Normalize / extract.
    let text = '';
    let title = item.title ?? '';
    let sourceFormat = 'text';
    if (item.kind === 'file') {
      if (!existsSync(item.payload)) return { status: 'rejected', reason: 'io' };
      if (statSync(item.payload).size > MAX_FILE) return { status: 'rejected', reason: 'size' };
      try {
        const ex = await d.extractFile(item.payload);
        text = ex.text;
        sourceFormat = ex.sourceFormat;
        if (!title) title = ex.title ?? basename(item.payload);
      } catch {
        return { status: 'rejected', reason: 'unsupported' };
      }
    } else if (item.kind === 'url') {
      // MVP: use browser-supplied selection/html, else the raw URL string. A guarded
      // server-side fetch (SSRF-checked) is P2.
      text = item.sourceMeta?.selection || item.sourceMeta?.html || item.payload;
      sourceFormat = 'url';
      if (!title) title = item.payload;
    } else {
      text = item.payload;
      if (text.length > MAX_TEXT) return { status: 'rejected', reason: 'size' };
    }
    if (!text.trim()) return { status: 'rejected', reason: 'unsupported' };

    // 2. Dedup (cheap, before any write).
    const hash = contentHash(text);
    const dup = d.queue.hashGet(hash);
    if (dup) return { status: 'duplicate', duplicateOf: dup };

    // 3. Ingest → .md note (lands in the stage folder via core's classifyStage).
    const input: IngestInput = {
      type: ingestTypeFor(item.kind, sourceFormat),
      content: text,
      title: title || undefined,
      tags: item.tags,
      source: sourceLabel(item),
      stage: item.stageHint,
    };
    const res = d.ingest(d.vaultPath, input);
    const absPath = resolve(d.vaultPath, res.savedTo);

    // 4. Embed for classification (cap length; classify cold on failure).
    let embedding: number[] = [];
    try {
      embedding = await d.embed(text.slice(0, 4000));
    } catch {
      /* embedder hiccup → cold classify (review queue), never blocks capture */
    }

    // 5. Classify (local-first; LLM boost is the caller's concern, off in MVP).
    const cats = d.classifyDao.getActiveCategories();
    const ctx: NoteCtx = {
      embedding, entities: res.tags ?? [], tags: res.tags ?? [],
      title: res.title, path: res.savedTo, sourceType: sourceFormat,
    };
    const cr: ClassifyResult = d.classify(ctx, cats, d.cfg);

    // 6. Route → journal. MVP = frontmatter mode: classification recorded in the DAO,
    //    note is NOT physically moved. AUTO vs REVIEW differ only in journal status.
    const decidedAt = this.nowIso();
    d.classifyDao.appendJournal({
      id: item.id,
      notePath: absPath,
      categoryId: cr.categoryId,
      confidence: cr.confidence,
      method: cr.method,
      band: cr.band,
      status: cr.band === 'auto' ? 'auto-filed' : 'review-pending',
      alternatives: cr.alternatives,
      stage: res.stage,
      source: item.source,
      decidedAt,
      decidedBy: 'auto',
    });
    // Auto-file nudges the winning category's centroid toward the new note.
    if (cr.band === 'auto' && cr.categoryId && embedding.length > 0) {
      const cat = d.classifyDao.getCategory(cr.categoryId);
      if (cat) {
        d.classifyDao.updateCentroid(cat.id, incrementalCentroid(cat.centroid, embedding, cat.memberCount), cat.memberCount + 1);
      }
    }

    // 7. Index immediately (read-after-write) + seed decay + record dedup hash.
    await d.indexFile(absPath);
    d.recordCapture(absPath);
    d.queue.hashPut(hash, absPath);

    return {
      status: 'created',
      savedTo: absPath,
      title: res.title,
      stage: res.stage as CaptureStage,
      categories: cr.categoryId ? [cr.categoryId] : [],
      confidence: cr.confidence,
      decision: cr.band === 'auto' ? 'auto' : 'review',
      indexed: true,
    };
  }
}
