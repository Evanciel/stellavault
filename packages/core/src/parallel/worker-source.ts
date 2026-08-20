// Design Ref: §4.2 — Graph Data 생성 알고리즘 (all-pairs edge pass)
// Plan SC: exact full-vault k-NN edges without the single-threaded O(n²) stall.

/**
 * The worker body ships as a STRING, and is launched with
 * `new Worker(EDGE_TOPK_WORKER_SOURCE, { eval: true, workerData })`.
 *
 * WHY a string and not `new Worker(new URL('./edge-worker.js', import.meta.url))` — the URL
 * form was measured working in exactly ONE of the four surfaces this package ships through:
 *
 *   vitest        import.meta.url is the .ts path → resolves to a file that does not exist
 *   esbuild CLI   the pattern is passed through verbatim; no sidecar is emitted and none is
 *                 listed in package.json "files" → ENOENT from a published install
 *   Electron      Vite inlines core into a CJS chunk that contains ZERO import.meta
 *   node dist/    works
 *
 * A string constant lives inside the JS module, so it survives tsc, esbuild, Vite and asar
 * packing identically (esbuild ESM + minified-CJS 서피스는 직접 재확인(import.meta 0개, 사이드카 없음, 워커 기동 OK). asar 서피스는 이 레인에서 패키징을 돌릴 수 없어 미확인).
 *
 * Constraints that follow from `eval: true`, and why this body looks the way it does:
 *  - the module base is `file://<cwd>/[eval1]`, so NO bare specifier and NO relative import
 *    can resolve. node: builtins only, and the body must stay self-contained.
 *  - CJS flavour (`require`), not top-level `import`: ESM-in-eval relies on Node's syntax
 *    detection, which is only on by default in newer Node, and engines still allows 20.0.
 */
export const EDGE_TOPK_WORKER_SOURCE = `
'use strict';
const { parentPort, workerData } = require('node:worker_threads');

// One SharedArrayBuffer of unit-normalized vectors, shared read-only by every worker.
// No copy per worker: at the 17k vault this view is 26.6 MB that would otherwise be cloned
// once per worker (~425 MB of pure memcpy).
const flat = new Float32Array(workerData.buf);
const n = workerData.n | 0;
const dim = workerData.dim | 0;
const K = workerData.K | 0;
const threshold = +workerData.threshold;

// Each task owns the row range [lo, hi) and scans ALL j for those rows (skipping j === i).
// Every pair is therefore computed twice across the pool — 2x the serial FLOPs — but each
// worker writes ONLY its own rows' slots, so there is nothing to merge and no lost update.
// A half-matrix split would need the j-side offers merged back, which is both more code and
// a place for the serial result to drift.
//
// IDENTICAL-TO-SERIAL, and this is load-bearing: in the serial loop row r receives offers
// from outer i<r (peers 0..r-1, ascending) and then from its own outer pass (peers
// r+1..n-1, ascending) — i.e. ascending peer index overall, which is exactly the j order
// here. Same offer sequence + same replace rule => same slots. The dot products match to
// the bit too: float multiply is commutative in IEEE-754 and the d-summation order is the
// same ascending walk on both sides.
parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'range') return;
  const lo = msg.lo | 0;
  const hi = msg.hi | 0;
  const rows = hi - lo;
  const sim = new Float32Array(rows * K).fill(-1);
  const peer = new Int32Array(rows * K).fill(-1);

  const scan = (from, to, base, oi) => {
    for (let j = from; j < to; j++) {
      const oj = j * dim;
      let s = 0;
      for (let d = 0; d < dim; d++) s += flat[oi + d] * flat[oj + d];
      // \`s >= threshold\`, not \`!(s < threshold)\`: NaN must fall through the same way the
      // serial guard does (both false => skipped).
      if (s >= threshold) {
        let worst = 0;
        for (let t = 1; t < K; t++) if (sim[base + t] < sim[base + worst]) worst = t;
        if (s > sim[base + worst]) {
          sim[base + worst] = s;
          peer[base + worst] = j;
        }
      }
    }
  };

  for (let i = lo; i < hi; i++) {
    const oi = i * dim;
    const base = (i - lo) * K;
    // Two ranges rather than one range with \`if (j === i) continue\` — the self-pair is a
    // single row-level special case, not something the innermost loop should re-test n times.
    // Ascending overall (0..i-1 then i+1..n-1), which is the ordering the serial equivalence
    // depends on.
    scan(0, i, base, oi);
    scan(i + 1, n, base, oi);
  }

  // Transfer, don't clone: the slot arrays are dead here the moment they are posted.
  parentPort.postMessage({ type: 'result', lo: lo, hi: hi, sim: sim, peer: peer }, [sim.buffer, peer.buffer]);
});
`;
