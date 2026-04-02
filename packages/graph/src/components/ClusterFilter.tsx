// 클러스터 필터 — zustand store 기반

import { useState } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

export function ClusterFilter() {
  const clusters = useGraphStore((s) => s.clusters);
  const hiddenClusters = useGraphStore((s) => s.hiddenClusters);
  const toggleHiddenCluster = useGraphStore((s) => s.toggleHiddenCluster);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';
  const [open, setOpen] = useState(false);

  if (clusters.length === 0) return null;

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
        Clusters {hiddenClusters.size > 0 ? `(${clusters.length - hiddenClusters.size}/${clusters.length})` : ''}
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
          {[...clusters]
            .sort((a, b) => b.nodeCount - a.nodeCount)
            .map((c) => (
            <label
              key={c.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '4px 6px', borderRadius: '4px', cursor: 'pointer',
                opacity: hiddenClusters.has(c.id) ? 0.3 : 1,
                fontSize: '11px', color: isDark ? '#aab' : '#444',
              }}
            >
              <div style={{
                width: '10px', height: '10px', borderRadius: '50%',
                background: hiddenClusters.has(c.id) ? '#333' : c.color,
                flexShrink: 0,
              }} />
              <span style={{ flex: 1 }}>{c.label}</span>
              <span style={{ color: '#556', fontSize: '10px' }}>{c.nodeCount}</span>
              <input
                type="checkbox"
                checked={!hiddenClusters.has(c.id)}
                onChange={() => toggleHiddenCluster(c.id)}
                style={{ accentColor: c.color }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
