import { useGraphStore } from '../stores/graph-store.js';
import { ExportPanel } from './ExportPanel.js';

export function StatusBar() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const clusters = useGraphStore((s) => s.clusters);
  const loading = useGraphStore((s) => s.loading);
  const mode = useGraphStore((s) => s.mode);
  const lodLevel = useGraphStore((s) => s.lodLevel);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';
  const showHeatmap = useGraphStore((s) => s.showHeatmap);
  const toggleHeatmap = useGraphStore((s) => s.toggleHeatmap);
  const showGaps = useGraphStore((s) => s.showGaps);
  const toggleGaps = useGraphStore((s) => s.toggleGaps);

  return (
    <div style={{
      padding: '6px 16px',
      background: isDark ? 'rgba(10, 10, 20, 0.8)' : 'rgba(240, 242, 248, 0.95)',
      borderTop: `1px solid ${isDark ? 'rgba(100, 120, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)'}`,
      fontSize: '11px',
      color: isDark ? '#667' : '#556',
      display: 'flex',
      gap: '20px',
      alignItems: 'center',
    }}>
      {loading ? (
        <span>Loading...</span>
      ) : (
        <>
          <span>{nodes.length} docs</span>
          <span>{edges.length} edges</span>
          <span>{clusters.length} clusters</span>
          <span style={{ color: '#556' }}>|</span>
          <span style={{ color: mode === 'semantic' ? '#88aaff' : '#88cc88' }}>
            {mode === 'semantic' ? 'AI Semantic' : 'Obsidian Folders'}
          </span>
          <span style={{ color: '#556' }}>|</span>
          <span style={{ color: lodLevel === 'universe' ? '#c088ff' : lodLevel === 'note' ? '#88ffaa' : '#88aaff' }}>
            {lodLevel}
          </span>
          <span style={{ color: '#445', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {clusters.map(c => c.label).join(' · ')}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={toggleHeatmap}
              title="Knowledge Heatmap"
              style={{
                background: showHeatmap ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                border: `1px solid ${showHeatmap ? 'rgba(239, 68, 68, 0.4)' : 'rgba(100,120,255,0.15)'}`,
                color: showHeatmap ? '#ef4444' : (isDark ? '#667' : '#556'),
                borderRadius: '4px',
                padding: '2px 6px',
                cursor: 'pointer',
                fontSize: '10px',
              }}
            >
              Heatmap
            </button>
            <button
              onClick={toggleGaps}
              title="Knowledge Gaps"
              style={{
                background: showGaps ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                border: `1px solid ${showGaps ? 'rgba(239, 68, 68, 0.4)' : 'rgba(100,120,255,0.15)'}`,
                color: showGaps ? '#ef4444' : (isDark ? '#667' : '#556'),
                borderRadius: '4px',
                padding: '2px 6px',
                cursor: 'pointer',
                fontSize: '10px',
              }}
            >
              Gaps
            </button>
            <ExportPanel />
            <span style={{ color: '#334', fontSize: '10px' }}>
              ESC=reset · /=search
            </span>
          </div>
        </>
      )}
    </div>
  );
}
