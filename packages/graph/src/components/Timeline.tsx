// 지식 타임라인 — 시간 축 슬라이더로 노트 생성/수정 이력 필터

import { useMemo, useCallback } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

export function Timeline() {
  const nodes = useGraphStore((s) => s.nodes);
  const showTimeline = useGraphStore((s) => s.showTimeline);
  const timelineRange = useGraphStore((s) => s.timelineRange);
  const setTimelineRange = useGraphStore((s) => s.setTimelineRange);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';

  // 전체 날짜 범위 계산
  const { minMs, maxMs, histogram } = useMemo(() => {
    const timestamps: number[] = [];
    for (const n of nodes) {
      if (n.lastModified) {
        const ms = new Date(n.lastModified).getTime();
        if (!isNaN(ms)) timestamps.push(ms);
      }
    }
    if (timestamps.length === 0) return { minMs: 0, maxMs: 0, histogram: [] as number[] };

    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    const range = max - min || 1;

    // 50 bin 히스토그램
    const bins = 50;
    const hist = new Array(bins).fill(0);
    for (const ts of timestamps) {
      const idx = Math.min(Math.floor(((ts - min) / range) * bins), bins - 1);
      hist[idx]++;
    }
    return { minMs: min, maxMs: max, histogram: hist };
  }, [nodes]);

  // 현재 범위 내 노드 수
  const activeCount = useMemo(() => {
    if (!timelineRange) return nodes.length;
    const [start, end] = timelineRange;
    return nodes.filter((n) => {
      if (!n.lastModified) return true;
      const ms = new Date(n.lastModified).getTime();
      return ms >= start && ms <= end;
    }).length;
  }, [nodes, timelineRange]);

  const handleStartChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    const end = timelineRange ? timelineRange[1] : maxMs;
    setTimelineRange([Math.min(val, end), end]);
  }, [timelineRange, maxMs, setTimelineRange]);

  const handleEndChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    const start = timelineRange ? timelineRange[0] : minMs;
    setTimelineRange([start, Math.max(val, start)]);
  }, [timelineRange, minMs, setTimelineRange]);

  const resetRange = useCallback(() => {
    setTimelineRange(null);
  }, [setTimelineRange]);

  if (!showTimeline || minMs === 0) return null;

  const startVal = timelineRange ? timelineRange[0] : minMs;
  const endVal = timelineRange ? timelineRange[1] : maxMs;
  const maxHist = Math.max(1, ...histogram);

  const formatDate = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div style={{
      padding: '8px 16px',
      background: isDark ? 'rgba(10,10,20,0.9)' : 'rgba(240,242,248,0.97)',
      borderTop: `1px solid ${isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
      backdropFilter: 'blur(8px)',
    }}>
      {/* 히스토그램 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1px', height: '30px', marginBottom: '4px' }}>
        {histogram.map((count, i) => {
          const binStart = minMs + (i / histogram.length) * (maxMs - minMs);
          const binEnd = minMs + ((i + 1) / histogram.length) * (maxMs - minMs);
          const inRange = binStart >= startVal && binEnd <= endVal;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${(count / maxHist) * 100}%`,
                minHeight: count > 0 ? '2px' : '0',
                background: inRange
                  ? (isDark ? 'rgba(100,180,255,0.6)' : 'rgba(59,130,246,0.5)')
                  : (isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.08)'),
                borderRadius: '1px 1px 0 0',
                transition: 'background 0.15s',
              }}
            />
          );
        })}
      </div>

      {/* 슬라이더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '10px', color: isDark ? '#667' : '#999', minWidth: '90px' }}>
          {formatDate(startVal)}
        </span>
        <input
          type="range"
          min={minMs}
          max={maxMs}
          value={startVal}
          onChange={handleStartChange}
          style={{ flex: 1, accentColor: isDark ? '#6488ff' : '#3b82f6' }}
        />
        <input
          type="range"
          min={minMs}
          max={maxMs}
          value={endVal}
          onChange={handleEndChange}
          style={{ flex: 1, accentColor: isDark ? '#6488ff' : '#3b82f6' }}
        />
        <span style={{ fontSize: '10px', color: isDark ? '#667' : '#999', minWidth: '90px', textAlign: 'right' }}>
          {formatDate(endVal)}
        </span>
        <button
          onClick={resetRange}
          style={{
            fontSize: '10px', padding: '2px 6px', border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
            borderRadius: '3px', cursor: 'pointer',
            background: isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.03)',
            color: isDark ? '#aab' : '#555',
          }}
        >
          Reset
        </button>
      </div>

      {/* 상태 */}
      <div style={{ fontSize: '10px', color: isDark ? '#556' : '#888', marginTop: '2px', textAlign: 'center' }}>
        {activeCount}/{nodes.length} docs in range
      </div>
    </div>
  );
}
