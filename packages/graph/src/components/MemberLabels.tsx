// Member-node labels for the DRILLED-DOWN cluster view. When you click a cluster super-node we
// full-replace the graph with that cluster's member notes (raw GraphNodes = dots, no text). Those
// dots alone are unreadable — you can't tell what you drilled into. This mounts drei <Billboard> +
// <Text> for the members so names show.
//
// Bounded + decluttered so it never becomes the 8000-label hairball the raw view would be:
//  - only the drilled view (view==='cluster' AND the nodes are NOT super-nodes) renders it
//  - caps to the TOP_N most-connected members (the rest are reachable by hover → tooltip)
//  - one per-frame pass fades labels by camera distance (near = bright, far = faint), so orbiting
//    surfaces whatever you lean toward instead of piling every name on top of each other.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useGraphStore } from '../stores/graph-store.js';

const _tmp = new THREE.Vector3();
// Enough names to read the cluster's shape without tanking FPS or stacking captions.
const TOP_N = 45;

export function MemberLabels() {
  const nodes = useGraphStore((s) => s.nodes);
  const view = useGraphStore((s) => s.view);
  const theme = useGraphStore((s) => s.theme);
  const isLight = theme === 'light';

  const labelRefs = useRef<Map<string, { t: any; pos: [number, number, number]; rel: number; op: number }>>(new Map());
  const frame = useRef(0);

  // Drilled member view only: cluster view but the nodes are members, not super-nodes.
  const isDrilldown = view === 'cluster' && nodes.length > 0 && !nodes[0]?.isCluster;

  const shown = useMemo(() => {
    if (!isDrilldown) return [];
    return [...nodes]
      .filter((n) => n.position)
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
      .slice(0, TOP_N);
  }, [isDrilldown, nodes]);

  const maxSize = useMemo(() => Math.max(...shown.map((n) => n.size ?? 1), 1), [shown]);

  useFrame(({ camera }) => {
    // Throttle: troika .sync() per label is costly; running it every frame for ~45 labels while
    // the camera tweens starves the main thread and makes the zoom crawl. Every 4th frame is
    // smooth enough for a fade.
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
      const df = 1 - (ds[i] - dmin) / range;
      const depth = 0.14 + 0.86 * Math.pow(df, 1.6);
      const op = depth * (0.4 + 0.6 * e.rel);
      if (Math.abs(e.op - op) > 0.012) {
        e.op = op;
        e.t.fillOpacity = op;
        e.t.outlineOpacity = op * 0.75;
        e.t.sync();
      }
    }
  });

  if (!isDrilldown) {
    if (labelRefs.current.size) labelRefs.current.clear();
    return null;
  }

  const fillColor = isLight ? '#1e293b' : '#e2e8f0';
  const outlineColor = isLight ? '#ffffff' : '#05050f';

  return (
    <group>
      {shown.map((n) => {
        const sz = n.size ?? 1;
        const rel = Math.sqrt(sz) / Math.sqrt(maxSize);
        const fontSize = 1.2 + 0.5 * rel; // ~1.2 .. 1.7, quiet note captions
        const [x, y, z] = n.position!;
        const label = n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label;
        return (
          <Billboard key={n.id} position={[x, y + 1.6, z]}>
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
              {label}
            </Text>
          </Billboard>
        );
      })}
    </group>
  );
}
