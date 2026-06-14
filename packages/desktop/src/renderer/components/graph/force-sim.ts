// Custom 3D velocity-Verlet force simulation — d3-force semantics, zero deps.
// Forces: many-body repulsion (uniform-grid neighbor search with a hard
// distance² cutoff — no Barnes-Hut needed under the 3k node cap), link springs
// toward a rest length (degree-biased like d3's default), center gravity, and
// velocity damping. Alpha cooling decays the sim to rest; any interaction
// (drag, slider change, new data) re-heats it (alphaTarget), exactly like
// Obsidian's graph feel.

export interface SimSettings {
  /** Repel slider 0–20 (Obsidian-style multiplier of a base charge). */
  repel: number;
  /** Link spring strength 0–1. */
  link: number;
  /** Center gravity 0–1. */
  center: number;
  /** Link rest length (world units). */
  linkDistance: number;
}

export const DEFAULT_SIM_SETTINGS: SimSettings = {
  repel: 8,
  link: 1,
  center: 0.15,
  linkDistance: 60,
};

interface SimLink {
  a: number;
  b: number;
  /** d3 default link strength: 1 / min(degree(a), degree(b)) — keeps hubs stable. */
  bias: number;
}

const ALPHA_DECAY = 0.0228;
const ALPHA_MIN = 0.001;
const VELOCITY_DAMPING = 0.85;
const MAX_VELOCITY = 6;          // units/tick cap — kills explosions
const REPEL_CUTOFF = 110;        // early-out distance for repulsion
const REPEL_BASE = 80;           // slider × base = charge strength

export class ForceSim {
  readonly n: number;
  readonly pos: Float32Array;     // n*3 — read by the renderer every frame
  private readonly vel: Float32Array;
  private readonly links: SimLink[];
  private alpha = 1;
  private alphaTarget = 0;
  /** Pinned node during drag (fx/fy/fz semantics) — null when free. */
  private fixedIndex: number | null = null;
  private readonly fixedPos = new Float32Array(3);
  /**
   * T2-9: 2D mode. When true the sim is constrained to the z=0 plane — every
   * tick zeroes z position + velocity so the layout is flat (paired with an
   * orthographic, top-down camera in GraphView). Toggled live via setFlat().
   */
  private flat = false;
  // Grid scratch (reused across ticks).
  private readonly grid = new Map<number, number[]>();

  constructor(initialPositions: Float32Array, edges: Array<[number, number]>) {
    this.n = Math.floor(initialPositions.length / 3);
    this.pos = initialPositions.slice();
    this.vel = new Float32Array(this.n * 3);
    const degree = new Array<number>(this.n).fill(0);
    for (const [a, b] of edges) {
      if (a >= 0 && a < this.n && b >= 0 && b < this.n) {
        degree[a]++;
        degree[b]++;
      }
    }
    this.links = [];
    for (const [a, b] of edges) {
      if (a < 0 || a >= this.n || b < 0 || b >= this.n || a === b) continue;
      this.links.push({ a, b, bias: 1 / Math.max(1, Math.min(degree[a], degree[b])) });
    }
  }

  /** Re-heat: drag start / slider change / data change. d3: alphaTarget(0.3).restart() */
  reheat(target = 0.3): void {
    this.alphaTarget = target;
    if (this.alpha < target) this.alpha = target;
  }

  /** Cool back down (drag release). */
  cool(): void {
    this.alphaTarget = 0;
  }

  /**
   * T2-9: enter/leave 2D mode. On entering, immediately flatten z so the switch
   * is instant; the per-tick constraint then keeps it flat. Re-heats so the
   * layout settles into the plane.
   */
  setFlat(flat: boolean): void {
    if (this.flat === flat) return;
    this.flat = flat;
    if (flat) {
      for (let i = 0; i < this.n; i++) {
        this.pos[i * 3 + 2] = 0;
        this.vel[i * 3 + 2] = 0;
      }
    }
    this.reheat(0.3);
  }

  /** Pin a node at a world position (drag). Keeps the sim running. */
  pin(index: number, x: number, y: number, z: number): void {
    this.fixedIndex = index;
    this.fixedPos[0] = x;
    this.fixedPos[1] = y;
    this.fixedPos[2] = z;
    this.pos[index * 3] = x;
    this.pos[index * 3 + 1] = y;
    this.pos[index * 3 + 2] = z;
    this.vel[index * 3] = 0;
    this.vel[index * 3 + 1] = 0;
    this.vel[index * 3 + 2] = 0;
  }

  /** Release the pinned node — it floats free again (Obsidian does NOT pin permanently). */
  unpin(): void {
    this.fixedIndex = null;
  }

  get isResting(): boolean {
    return this.alpha < ALPHA_MIN && this.alphaTarget < ALPHA_MIN;
  }

  /**
   * One simulation step. `dtScale` is the clamped frame-time ratio (1 = 60fps).
   * Returns false when the sim is at rest (nothing moved).
   */
  tick(settings: SimSettings, dtScale = 1): boolean {
    if (this.isResting) return false;
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY * dtScale;
    const alpha = this.alpha;
    const { pos, vel, n } = this;
    const step = Math.min(Math.max(dtScale, 0.25), 2); // clamp dt

    // ── Repulsion: uniform grid hashing, hard cutoff ──
    const cell = REPEL_CUTOFF;
    const grid = this.grid;
    grid.clear();
    for (let i = 0; i < n; i++) {
      const key = gridKey(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], cell);
      const bucket = grid.get(key);
      if (bucket) bucket.push(i); else grid.set(key, [i]);
    }
    const charge = settings.repel * REPEL_BASE;
    const cutoff2 = REPEL_CUTOFF * REPEL_CUTOFF;
    if (charge > 0) {
      for (let i = 0; i < n; i++) {
        const ix = pos[i * 3], iy = pos[i * 3 + 1], iz = pos[i * 3 + 2];
        const cx = Math.floor(ix / cell), cy = Math.floor(iy / cell), cz = Math.floor(iz / cell);
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            for (let oz = -1; oz <= 1; oz++) {
              const bucket = grid.get(packKey(cx + ox, cy + oy, cz + oz));
              if (!bucket) continue;
              for (const j of bucket) {
                if (j <= i) continue; // pair once, apply symmetric
                let dx = pos[j * 3] - ix;
                let dy = pos[j * 3 + 1] - iy;
                let dz = pos[j * 3 + 2] - iz;
                let d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > cutoff2) continue; // early-out by distance² cap
                if (d2 < 1e-4) {
                  // Coincident nodes: deterministic jiggle so they separate.
                  dx = ((i * 31 + j) % 7 - 3) * 0.01 || 0.01;
                  dy = ((i * 17 + j) % 5 - 2) * 0.01 || 0.01;
                  dz = 0.01;
                  d2 = dx * dx + dy * dy + dz * dz;
                }
                const w = (charge * alpha) / d2;
                const wx = dx * w, wy = dy * w, wz = dz * w;
                vel[j * 3] += wx; vel[j * 3 + 1] += wy; vel[j * 3 + 2] += wz;
                vel[i * 3] -= wx; vel[i * 3 + 1] -= wy; vel[i * 3 + 2] -= wz;
              }
            }
          }
        }
      }
    }

    // ── Link springs toward linkDistance (d3 forceLink semantics) ──
    const linkStrength = settings.link;
    if (linkStrength > 0) {
      for (const { a, b, bias } of this.links) {
        let dx = pos[b * 3] - pos[a * 3];
        let dy = pos[b * 3 + 1] - pos[a * 3 + 1];
        let dz = pos[b * 3 + 2] - pos[a * 3 + 2];
        let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 1e-3) { dx = 0.01; dy = 0.01; dz = 0; dist = Math.sqrt(dx * dx + dy * dy + dz * dz); }
        const f = ((dist - settings.linkDistance) / dist) * alpha * linkStrength * bias;
        const fx = dx * f * 0.5, fy = dy * f * 0.5, fz = dz * f * 0.5;
        vel[b * 3] -= fx; vel[b * 3 + 1] -= fy; vel[b * 3 + 2] -= fz;
        vel[a * 3] += fx; vel[a * 3 + 1] += fy; vel[a * 3 + 2] += fz;
      }
    }

    // ── Center gravity ──
    const centerK = settings.center * 0.1; // slider 0–1 → effective 0–0.1 (d3-ish)
    if (centerK > 0) {
      for (let i = 0; i < n; i++) {
        vel[i * 3] -= pos[i * 3] * centerK * alpha;
        vel[i * 3 + 1] -= pos[i * 3 + 1] * centerK * alpha;
        vel[i * 3 + 2] -= pos[i * 3 + 2] * centerK * alpha;
      }
    }

    // ── Integrate: damp, cap velocity, move ──
    for (let i = 0; i < n; i++) {
      if (i === this.fixedIndex) {
        pos[i * 3] = this.fixedPos[0];
        pos[i * 3 + 1] = this.fixedPos[1];
        pos[i * 3 + 2] = this.fixedPos[2];
        vel[i * 3] = 0; vel[i * 3 + 1] = 0; vel[i * 3 + 2] = 0;
        continue;
      }
      let vx = vel[i * 3] * VELOCITY_DAMPING;
      let vy = vel[i * 3 + 1] * VELOCITY_DAMPING;
      let vz = vel[i * 3 + 2] * VELOCITY_DAMPING;
      const speed2 = vx * vx + vy * vy + vz * vz;
      if (speed2 > MAX_VELOCITY * MAX_VELOCITY) {
        const k = MAX_VELOCITY / Math.sqrt(speed2);
        vx *= k; vy *= k; vz *= k;
      }
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      pos[i * 3] += vx * step;
      pos[i * 3 + 1] += vy * step;
      pos[i * 3 + 2] += vz * step;
      // T2-9: 2D mode — pin to the z=0 plane.
      if (this.flat) { pos[i * 3 + 2] = 0; vel[i * 3 + 2] = 0; }
    }
    return true;
  }
}

function gridKey(x: number, y: number, z: number, cell: number): number {
  return packKey(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell));
}

// Pack 3 small signed ints into one number (cells stay within ±8192 easily).
function packKey(ix: number, iy: number, iz: number): number {
  return ((ix + 16384) * 32768 + (iy + 16384)) * 32768 + (iz + 16384);
}
