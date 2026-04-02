// Design Ref: §5 — 감쇠 데이터 로딩 훅

import { useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

export interface DecayData {
  [documentId: string]: number; // retrievability 0~1
}

export function useDecay() {
  const showDecay = useGraphStore((s) => s.showDecayOverlay);
  const dataRef = useRef<DecayData>({});
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!showDecay || loadedRef.current) return;

    fetch('http://127.0.0.1:3333/api/decay')
      .then(r => r.json())
      .then(report => {
        if (!report.topDecaying) return;
        // Build map from all decaying notes
        const map: DecayData = {};
        // Default R=1 for all, then override with actual values
        for (const d of report.topDecaying) {
          map[d.documentId] = d.retrievability;
        }
        dataRef.current = map;
        loadedRef.current = true;
        // Force re-render
        useGraphStore.getState().setDecayData(map);
      })
      .catch(() => {});
  }, [showDecay]);

  return dataRef.current;
}
