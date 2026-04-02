// source/type 필터 — ClusterFilter 패턴 재활용

import { useState, useMemo } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

const TYPE_ICONS: Record<string, string> = {
  note: '📝', clip: '📎', sync: '🔄', bridge: '🌉',
  decision: '⚖️', snapshot: '📸',
};

const SOURCE_COLORS: Record<string, string> = {
  local: '#10b981', notion: '#3b82f6', clip: '#f59e0b',
  bridge: '#8b5cf6', pack: '#ec4899',
};

export function TypeFilter() {
  const nodes = useGraphStore((s) => s.nodes);
  const hiddenTypes = useGraphStore((s) => s.hiddenTypes);
  const toggleHiddenType = useGraphStore((s) => s.toggleHiddenType);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';
  const [open, setOpen] = useState(false);

  // source와 type별 노드 수 집계
  const { typeCounts, sourceCounts } = useMemo(() => {
    const tc = new Map<string, number>();
    const sc = new Map<string, number>();
    for (const n of nodes) {
      const t = n.type ?? 'note';
      const s = n.source ?? 'local';
      tc.set(t, (tc.get(t) ?? 0) + 1);
      sc.set(s, (sc.get(s) ?? 0) + 1);
    }
    return {
      typeCounts: [...tc.entries()].sort((a, b) => b[1] - a[1]),
      sourceCounts: [...sc.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [nodes]);

  const totalTypes = typeCounts.length + sourceCounts.length;
  if (totalTypes <= 1 && sourceCounts.length <= 1) return null;

  const activeFilters = hiddenTypes.size;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '4px 10px', fontSize: '11px',
          border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
          borderRadius: '4px', cursor: 'pointer',
          background: open
            ? (isDark ? 'rgba(100,120,255,0.2)' : 'rgba(0,0,0,0.08)')
            : (isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.03)'),
          color: isDark ? '#aab' : '#555',
        }}
      >
        Types {activeFilters > 0 ? `(-${activeFilters})` : ''}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: '6px',
          background: isDark ? 'rgba(10,10,20,0.95)' : 'rgba(255,255,255,0.97)',
          border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
          borderRadius: '8px', padding: '8px', minWidth: '200px',
          backdropFilter: 'blur(8px)', zIndex: 100,
          boxShadow: isDark ? 'none' : '0 4px 16px rgba(0,0,0,0.08)',
        }}>
          {/* Source section */}
          <div style={{ fontSize: '9px', color: isDark ? '#667' : '#999', padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Source
          </div>
          {sourceCounts.map(([source, count]) => {
            const key = `source:${source}`;
            const hidden = hiddenTypes.has(key);
            return (
              <label key={key} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '4px 6px', borderRadius: '4px', cursor: 'pointer',
                opacity: hidden ? 0.3 : 1,
                fontSize: '11px', color: isDark ? '#aab' : '#444',
              }}>
                <div style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: hidden ? '#333' : (SOURCE_COLORS[source] ?? '#666'),
                  flexShrink: 0,
                }} />
                <span style={{ flex: 1 }}>{source}</span>
                <span style={{ color: '#556', fontSize: '10px' }}>{count}</span>
                <input
                  type="checkbox"
                  checked={!hidden}
                  onChange={() => toggleHiddenType(key)}
                  style={{ accentColor: SOURCE_COLORS[source] ?? '#666' }}
                />
              </label>
            );
          })}

          {/* Type section */}
          <div style={{ fontSize: '9px', color: isDark ? '#667' : '#999', padding: '6px 6px 2px', textTransform: 'uppercase', letterSpacing: '0.5px', borderTop: `1px solid ${isDark ? 'rgba(100,120,255,0.08)' : 'rgba(0,0,0,0.06)'}`, marginTop: '4px' }}>
            Type
          </div>
          {typeCounts.map(([type, count]) => {
            const key = `type:${type}`;
            const hidden = hiddenTypes.has(key);
            return (
              <label key={key} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '4px 6px', borderRadius: '4px', cursor: 'pointer',
                opacity: hidden ? 0.3 : 1,
                fontSize: '11px', color: isDark ? '#aab' : '#444',
              }}>
                <span style={{ fontSize: '12px', flexShrink: 0 }}>{TYPE_ICONS[type] ?? '📄'}</span>
                <span style={{ flex: 1 }}>{type}</span>
                <span style={{ color: '#556', fontSize: '10px' }}>{count}</span>
                <input
                  type="checkbox"
                  checked={!hidden}
                  onChange={() => toggleHiddenType(key)}
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
