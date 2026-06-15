// Generates the Stellavault Web Clipper extension icons (16/32/48/128 px) as
// PNGs, with no external image dependency — a self-contained, deterministic
// rasterizer (4x supersampled for anti-aliasing, zlib-deflated PNG output).
//
// Motif: the Stellavault deep-space brand — a dark rounded tile, a soft central
// 4-point sparkle (the "star" in Stellavault) with glow, and a couple of faint
// constellation companions + link line.
//
// Run:  node scripts/make-web-clipper-icon.mjs
// Output: tools/web-clipper/{icon.png, icon48.png, icon32.png, icon16.png}

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'web-clipper');

// ── PNG encoder (truecolor + alpha) ────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── drawing ─────────────────────────────────────────────────────────────────
const TOP = [12, 16, 40];      // deep navy (top of tile)
const BOT = [4, 5, 13];        // near-black (bottom)
const ACCENT = [128, 170, 255]; // signature blue
const CORE = [240, 246, 255];   // near-white star core
const VIOLET = [180, 150, 255]; // companion accent

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Companion stars (fixed, deterministic): [x, y, radius, color]
const COMPS = [
  [0.745, 0.295, 0.020, VIOLET],
  [0.290, 0.690, 0.015, ACCENT],
  [0.680, 0.730, 0.011, CORE],
];

function lineGlow(u, v, ax, ay, bx, by, w) {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy;
  let t = ((u - ax) * vx + (v - ay) * vy) / l2;
  t = clamp(t, 0, 1);
  const d = Math.hypot(u - (ax + vx * t), v - (ay + vy * t));
  return Math.exp(-((d / w) ** 2));
}

// Returns straight-alpha [r,g,b,a] in 0..255 for normalized (u,v) in [0,1].
function sample(u, v) {
  const dx = u - 0.5, dy = v - 0.5;
  const r = Math.hypot(dx, dy);

  // background: vertical gradient + soft central glow
  let R = lerp(TOP[0], BOT[0], v), G = lerp(TOP[1], BOT[1], v), B = lerp(TOP[2], BOT[2], v);
  const glow = Math.exp(-((r / 0.42) ** 2)) * 0.35;
  R += ACCENT[0] * glow; G += ACCENT[1] * glow; B += ACCENT[2] * glow;

  // faint constellation link (center → first companion)
  const lg = lineGlow(u, v, 0.5, 0.5, COMPS[0][0], COMPS[0][1], 0.006) * 0.22;
  R = lerp(R, ACCENT[0], lg); G = lerp(G, ACCENT[1], lg); B = lerp(B, ACCENT[2], lg);

  // companion stars
  for (const [cx, cy, rad, col] of COMPS) {
    const i = Math.exp(-((Math.hypot(u - cx, v - cy) / rad) ** 2));
    R = lerp(R, col[0], i); G = lerp(G, col[1], i); B = lerp(B, col[2], i);
  }

  // main 4-point sparkle: bright core + axis spikes
  const core = Math.exp(-((r / 0.055) ** 2));
  const spike = Math.exp(-((Math.min(Math.abs(dx), Math.abs(dy)) / 0.014) ** 2)) * Math.exp(-((r / 0.36) ** 2));
  const star = clamp(core * 1.1 + spike * 0.95, 0, 1);
  R = lerp(R, CORE[0], star); G = lerp(G, CORE[1], star); B = lerp(B, CORE[2], star);

  // rounded-rect alpha mask (transparent outside the tile)
  const half = 0.5, rc = 0.20;
  const qx = Math.abs(dx) - (half - rc), qy = Math.abs(dy) - (half - rc);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - rc;
  const alpha = 1 - smoothstep(0, 0.012, outside);

  return [clamp(R, 0, 255), clamp(G, 0, 255), clamp(B, 0, 255), clamp(alpha * 255, 0, 255)];
}

function render(size) {
  const SS = 4, S = size * SS, n = SS * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let pr = 0, pg = 0, pb = 0, pa = 0; // premultiplied accumulation
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x * SS + sx + 0.5) / S, (y * SS + sy + 0.5) / S);
          const a = c[3] / 255;
          pr += c[0] * a; pg += c[1] * a; pb += c[2] * a; pa += c[3];
        }
      }
      const idx = (y * size + x) * 4;
      if (pa > 0) {
        out[idx] = clamp(Math.round((pr * 255) / pa), 0, 255);
        out[idx + 1] = clamp(Math.round((pg * 255) / pa), 0, 255);
        out[idx + 2] = clamp(Math.round((pb * 255) / pa), 0, 255);
      }
      out[idx + 3] = clamp(Math.round(pa / n), 0, 255);
    }
  }
  return out;
}

for (const [size, name] of [[128, 'icon.png'], [48, 'icon48.png'], [32, 'icon32.png'], [16, 'icon16.png']]) {
  const png = encodePng(size, render(size));
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}
