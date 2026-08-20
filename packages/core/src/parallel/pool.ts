// Design Ref: §4.2 — Graph Data 생성 알고리즘 (all-pairs edge pass)
// Plan SC: full-vault graph build without the multi-minute Express event-loop stall.

import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { EDGE_TOPK_WORKER_SOURCE } from './worker-source.js';

/**
 * Measured on the user's real vault (17,303 docs, 384-dim, K=5) before this module existed:
 * the serial all-pairs cosine in buildGraphData took 101,527 ms. That was the whole reason
 * GRAPH_NODE_CAP existed at 1500. Splitting it row-wise over availableParallelism() workers
 * is EXACT — no approximation, no recall loss — but it is NOT a free 16x:
 *   - the symmetric split recomputes every pair from both endpoints: measured 2.26x the
 *     serial FLOPs (n=6000: W=1 20,535 ms vs serial 9,081 ms).
 *   - 16 logical = 8 physical + SMT, so pool scaling measured 7.15x, not 16x
 *     (n=6000 sweep: W=1 20,535 ms → W=16 2,870 ms, cleanly sublinear).
 * 101,527 x 2.26 / 7.15 ≈ 32 s — a measured-scaling EXTRAPOLATION, not a full-vault run.
 * That is 3.2x, not the 7.8x a naive 101.5s*2/16 would predict. Recovering the remaining ~2x
 * needs the triangle+merge split, which changes top-K slot ORDER (see the counterexample in
 * the equivalence test) and therefore the emitted edge order — a behaviour change, not a
 * drop-in. Do not "fix" this number upward without a real full-vault measurement.
 *
 * Rejected before landing on this, do not revisit without new numbers:
 *  - store.findDocumentNeighbors (sqlite-vec KNN per doc): 220 ms/doc → ~63 min. sqlite-vec
 *    MATCH is an exhaustive scan, not HNSW.
 *  - k-means cluster blocking: 46.5%–72% recall of the true top-5. Rejected on quality.
 */

/** Env kill switch. Parallel is ON by default; STELLAVAULT_PARALLEL=0 forces the serial loop. */
function parallelEnabled(): boolean {
  const v = process.env.STELLAVAULT_PARALLEL;
  return !(v === '0' || v === 'false' || v === 'off');
}

/**
 * Below this n the pool's own startup dominates. Serial is ~0.68 µs/pair, so n=1200 is
 * ~490 ms of work against ~200 ms of spawning 16 isolates plus the scheduling round-trips —
 * roughly break-even. Overridable so tests can exercise the parallel path at small n.
 */
const DEFAULT_MIN_N = 1200;
function minParallelN(): number {
  const raw = Number(process.env.STELLAVAULT_PARALLEL_MIN_N);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MIN_N;
}

/**
 * availableParallelism(), NOT cpus().length: the latter reports the HOST's cores and ignores
 * cgroup CPU limits, so a container-limited Electron/CI run would spawn far more isolates
 * than it can schedule.
 */
function poolSize(): number {
  const override = Number(process.env.STELLAVAULT_PARALLEL_WORKERS);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, cores);
}

/**
 * A stalled worker must not hang the graph build forever. The timer is reset by every
 * completed block, so it only fires on a genuinely wedged isolate; on fire we abandon the
 * pool and the caller re-runs serially.
 */
function blockTimeoutMs(): number {
  const raw = Number(process.env.STELLAVAULT_PARALLEL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120_000;
}

/**
 * Every worker this module has ever spawned and not yet terminated.
 *
 * An un-terminated worker_thread keeps its host process alive: in Electron that means the
 * main process survives the last window closing, and the app never quits. The pool clears
 * its own workers in a finally, this Set is the belt-and-braces for shutdownPool().
 */
const liveWorkers = new Set<Worker>();

/** Live (spawned, not yet terminated) worker count. Exposed for shutdown assertions. */
export function activeWorkerCount(): number {
  return liveWorkers.size;
}

/**
 * Terminate every live worker. Call from the host's shutdown path (Electron before-quit,
 * CLI exit) — see needsOutsideLane for the core barrel re-export.
 */
export async function shutdownPool(): Promise<void> {
  const all = [...liveWorkers];
  liveWorkers.clear();
  await Promise.all(all.map((w) => w.terminate().then(() => undefined, () => undefined)));
}

/**
 * Should the caller pack its vectors into a SharedArrayBuffer and try the pool?
 *
 * Answered BEFORE packing because the answer decides the allocation: a SharedArrayBuffer is
 * pointless (and on some hardened runtimes unavailable) when we are going to run serially.
 */
export function shouldParallelize(n: number): boolean {
  if (!parallelEnabled()) return false;
  if (n < minParallelN()) return false;
  if (typeof SharedArrayBuffer === 'undefined') return false;
  return true;
}

/**
 * Allocate the packed-vector array. `shared` comes from shouldParallelize(); a SAB-backed
 * Float32Array is a drop-in for every reader (the edge loop, kMeans) — only postMessage
 * treats it differently, by sharing instead of copying.
 */
export function allocPackedVectors(length: number, shared: boolean): Float32Array {
  if (shared && typeof SharedArrayBuffer !== 'undefined') {
    return new Float32Array(new SharedArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
  }
  return new Float32Array(length);
}

export interface TopKEdgeRequest {
  /** Unit-normalized vectors, n*dim, SharedArrayBuffer-backed (see allocPackedVectors). */
  flat: Float32Array;
  n: number;
  dim: number;
  /** Neighbours kept per node. */
  K: number;
  /** Cosine floor; a pair below it is not offered at all. */
  threshold: number;
  /** Destination slots, n*K, pre-filled with -1 by the caller. Written in place. */
  bestSim: Float32Array;
  bestPeer: Int32Array;
  workers?: number;
  onProgress?: (rowsDone: number, rowsTotal: number) => void;
}

/**
 * Fill bestSim/bestPeer with each row's top-K neighbours, computed in worker threads.
 *
 * Returns false — never throws — when the parallel path is unavailable or fails for ANY
 * reason (kill switch, small n, non-shared buffer, Worker construction throwing, a worker
 * dying mid-flight, watchdog). A graph build must not fail because thread spawning did, so
 * the caller resets the slots and runs the serial loop. Returns true only when every block
 * was accounted for.
 */
export async function computeTopKEdgesParallel(req: TopKEdgeRequest): Promise<boolean> {
  const { flat, n, dim, K, threshold, bestSim, bestPeer, onProgress } = req;
  if (n <= 1 || dim <= 0 || K <= 0) return false;
  if (!parallelEnabled()) return false;
  // postMessage would deep-COPY a plain ArrayBuffer into every worker; only a SAB is shared.
  if (typeof SharedArrayBuffer === 'undefined' || !(flat.buffer instanceof SharedArrayBuffer)) return false;

  const W = Math.max(1, Math.min(req.workers ?? poolSize(), n));
  // ~4 blocks per worker: the rows all cost the same (every row scans all n), so this is not
  // about load balance but about OS scheduling jitter and progress granularity — a single
  // block per worker reports 0% until it reports 100%.
  const blockRows = Math.max(1, Math.ceil(n / (W * 4)));
  const blocks: Array<[number, number]> = [];
  for (let lo = 0; lo < n; lo += blockRows) blocks.push([lo, Math.min(n, lo + blockRows)]);

  const workerData = { buf: flat.buffer, n, dim, K, threshold };

  return await new Promise<boolean>((resolve) => {
    const workers: Worker[] = [];
    let nextBlock = 0;
    let completedBlocks = 0;
    let rowsDone = 0;
    let settled = false;
    let watchdog: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      if (watchdog) clearTimeout(watchdog);
      for (const w of workers) {
        liveWorkers.delete(w);
        // Fire-and-forget: the result is already merged, and a terminate() rejection here
        // would surface as an unhandled rejection long after the build returned.
        void w.terminate().then(() => undefined, () => undefined);
      }
    };

    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok);
    };

    const armWatchdog = (): void => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => settle(false), blockTimeoutMs());
      // Do not let the watchdog itself hold the process open.
      watchdog.unref?.();
    };

    const dispatch = (w: Worker): void => {
      if (settled) return;
      if (nextBlock >= blocks.length) return; // drained; this worker idles until cleanup
      const [lo, hi] = blocks[nextBlock++];
      w.postMessage({ type: 'range', lo, hi });
    };

    const onMessage = (w: Worker, msg: unknown): void => {
      if (settled) return;
      const m = msg as { type?: string; lo?: number; sim?: Float32Array; peer?: Int32Array };
      if (!m || m.type !== 'result' || typeof m.lo !== 'number' || !m.sim || !m.peer) return;
      bestSim.set(m.sim, m.lo * K);
      bestPeer.set(m.peer, m.lo * K);
      rowsDone += m.sim.length / K;
      completedBlocks++;
      armWatchdog();
      // onProgress 는 호출자(서버 핸들러)가 준 콜백이다. 여기서 던지면 worker 의 'message'
      // 리스너 밖으로 나가 uncaughtException 이 되고, settle 도 dispatch 도 못 해서 런이
      // 120s 워치독까지 멈춰 있는다. 진행률 보고 실패가 빌드를 죽일 이유는 없다.
      try { onProgress?.(rowsDone, n); } catch { /* 진행률은 부가정보다 — 삼킨다 */ }
      if (completedBlocks === blocks.length) { settle(true); return; }
      dispatch(w);
    };

    try {
      for (let i = 0; i < Math.min(W, blocks.length); i++) {
        const w = new Worker(EDGE_TOPK_WORKER_SOURCE, { eval: true, workerData });
        workers.push(w);
        liveWorkers.add(w);
        w.on('message', (msg) => onMessage(w, msg));
        w.on('error', (err) => {
          console.error('[graph/parallel] worker failed, falling back to serial:', err);
          settle(false);
        });
        w.on('exit', () => {
          liveWorkers.delete(w);
          // ANY exit before we have settled means this worker's remaining blocks will never
          // arrive → fall back. Deliberately NOT gated on a non-zero code: terminate() on a
          // worker that has not finished bootstrapping yet resolves with code 0 (measured),
          // so a `code !== 0` guard silently missed exactly the case that matters — an
          // external shutdownPool() during a cold build — and left the build hanging until
          // the watchdog. Our own cleanup only terminates after settled = true, so a
          // pre-settle exit is always a genuine failure.
          settle(false);
        });
      }
    } catch (err) {
      console.error('[graph/parallel] worker spawn failed, falling back to serial:', err);
      settle(false);
      return;
    }

    if (workers.length === 0) { settle(false); return; }
    armWatchdog();
    for (const w of workers) dispatch(w);
  });
}
