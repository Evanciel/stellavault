// Cluster super-node labels — the ONE new render primitive for the cluster view.
// The Points cloud (GraphNodes) renders dots only, never text. We mount drei <Billboard>
// + <Text> for each folded super-node so the galaxy reads as labeled clusters.
//
// EVERY cluster gets a label (no hard drop — a planet with no name is confusing). Instead the
// declutter is DEPTH-BASED: a single per-frame pass measures each label's distance to the camera
// and fades the far ones toward faint while the near ones stay bright. As you orbit, the labels
// in front pop and the ones behind recede — readable without piling 35 equally-loud captions on
// top of each other. Member count is a secondary weight so small clusters stay quiet.
//
// Gated STRICTLY on node.isCluster (≤80 billboards). NEVER render for the raw view: 8000+
// troika <Text> instances would tank FPS. drei <Text>/<Billboard> self-dispose on unmount.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useGraphStore } from '../stores/graph-store.js';

// Cluster palette (matches GraphNodes.tsx PALETTE order) — the label is tinted to its OWN
// cluster colour instead of stark white, so it reads as part of the dot rather than a row of
// equally-loud captions. Each is softened toward white for legibility on the dark canvas.
const PALETTE_HEX = [
  '#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#8b5cf6',
  '#14b8a6', '#e879f9', '#eab308', '#22d3ee', '#fb7185',
];

/** Lighten a hex toward white by `t` (0..1) so saturated cluster colours stay readable. */
function soften(hex: string, t: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const _tmp = new THREE.Vector3();

export function ClusterLabels() {
  const nodes = useGraphStore((s) => s.nodes);
  const hiddenClusters = useGraphStore((s) => s.hiddenClusters);
  const theme = useGraphStore((s) => s.theme);
  const isLight = theme === 'light';

  // troika <Text> refs keyed by cluster id, plus each one's world position — the per-frame fade
  // pass reads these without going through React state (no re-render per frame).
  const labelRefs = useRef<Map<string, { t: any; pos: [number, number, number]; rel: number; op: number }>>(new Map());
  const frame = useRef(0);

  const clusterNodes = useMemo(
    () => nodes.filter((n) => n.isCluster && n.position && !hiddenClusters.has(n.clusterId)),
    [nodes, hiddenClusters],
  );

  const maxMc = useMemo(
    () => Math.max(...clusterNodes.map((n) => n.memberCount ?? 1), 1),
    [clusterNodes],
  );

  // Depth-based opacity: one pass, find the nearest/furthest label to the camera THIS frame, then
  // map each label front→back into bright→faint. Adapts to any zoom/orbit. Throttled: only push a
  // new opacity (and the troika .sync() it needs) when it actually moved, so a still camera is free.
  useFrame(({ camera }) => {
    // Throttle troika .sync() to every 4th frame — running it for every label each frame while the
    // camera tweens starves the main thread (made the drilldown zoom crawl). Smooth enough to fade.
    frame.current = (frame.current + 1) % 4;
    if (frame.current !== 0) return;
    const entries = [...labelRefs.current.values()].filter((e) => e.t);
    if (entries.length === 0) return;
    let dmin = Infinity, dmax = -Infinity;
    const ds: number[] = [];
    for (const e of entries) {
      const d = camera.position.distanceTo(_tmp.set(e.pos[0], e.pos[1], e.pos[2]));
      ds.push(d);
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
    }
    const range = Math.max(dmax - dmin, 1e-3);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const df = 1 - (ds[i] - dmin) / range;          // 1 = closest, 0 = furthest
      const depth = 0.12 + 0.88 * Math.pow(df, 1.7);   // steep falloff, faint floor (never fully gone)
      // Strong member weight so the crowded centre gets a clear hierarchy: a handful of big
      // clusters read boldly, the many small ones recede to faint captions instead of a pile.
      const op = depth * (0.3 + 0.7 * e.rel);
      if (Math.abs(e.op - op) > 0.012) {
        e.op = op;
        e.t.fillOpacity = op;
        e.t.outlineOpacity = op * 0.75;
        e.t.sync();
      }
    }
  });

  if (clusterNodes.length === 0) return null;

  // Outline contrasts against whichever canvas background is active (kept thin).
  const outlineColor = isLight ? '#ffffff' : '#05050f';

  return (
    <group>
      {clusterNodes.map((n) => {
        const mc = n.memberCount ?? 1;
        const rel = Math.sqrt(mc) / Math.sqrt(maxMc); // 0..1, bigger cluster → louder label
        // Deliberately small captions — faint constellation names, not banners. Range ≈ 1.4 .. 2.3.
        const fontSize = 1.3 + 0.12 * Math.min(8, Math.sqrt(mc));
        const base = PALETTE_HEX[n.clusterId % PALETTE_HEX.length];
        const fillColor = isLight ? base : soften(base, 0.28);
        const [x, y, z] = n.position!;
        // Keep it ONE horizontal line: drei <Text> maxWidth wraps, and CJK (Korean) breaks between
        // every glyph, so a long label stacked into vertical text. Truncate instead.
        const shown = n.label.length > 16 ? `${n.label.slice(0, 15)}…` : n.label;
        return (
          <Billboard key={n.id} position={[x, y + n.size * 0.2 + 1.4, z]}>
            <Text
              ref={(t) => {
                if (t) labelRefs.current.set(n.id, { t, pos: [x, y, z], rel, op: -1 });
                else labelRefs.current.delete(n.id);
              }}
              fontSize={fontSize}
              color={fillColor}
              fillOpacity={0.5}
              outlineWidth={fontSize * 0.06}
              outlineColor={outlineColor}
              outlineOpacity={0.4}
              anchorX="center"
              anchorY="middle"
            >
              {`${shown} (${mc})`}
            </Text>
          </Billboard>
        );
      })}
    </group>
  );
}
