import { useGraphStore } from '../stores/graph-store.js';
import { ExportPanel } from './ExportPanel.js';
import { getTheme } from '../lib/theme.js';
import { setUiLocale, getAvailableLocales } from '../lib/i18n.js';

export function StatusBar() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const clusters = useGraphStore((s) => s.clusters);
  const loading = useGraphStore((s) => s.loading);
  const mode = useGraphStore((s) => s.mode);
  const lodLevel = useGraphStore((s) => s.lodLevel);
  const themeMode = useGraphStore((s) => s.theme);
  const showHeatmap = useGraphStore((s) => s.showHeatmap);
  const toggleHeatmap = useGraphStore((s) => s.toggleHeatmap);
  const showGaps = useGraphStore((s) => s.showGaps);
  const toggleGaps = useGraphStore((s) => s.toggleGaps);
  const locale = useGraphStore((s) => s.locale);
  const setLocale = useGraphStore((s) => s.setLocale);

  const t = getTheme(themeMode);

  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
    border: `1px solid ${active ? 'rgba(239, 68, 68, 0.4)' : t.buttonBorder}`,
    color: active ? t.danger : t.textMuted,
    borderRadius: '4px',
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: '10px',
    transition: 'all 0.15s ease',
  });

  return (
    <div style={{
      padding: '6px 16px',
      background: t.bg,
      borderTop: `1px solid ${t.border}`,
      fontSize: '11px',
      color: t.textMuted,
      display: 'flex',
      gap: '20px',
      alignItems: 'center',
      transition: 'background 0.3s ease, color 0.3s ease',
    }}>
      {loading ? (
        <span>Loading...</span>
      ) : (
        <>
          <span>{nodes.length} docs</span>
          <span>{edges.length} edges</span>
          <span>{clusters.length} clusters</span>
          <span style={{ color: t.textDim }}>|</span>
          <span style={{ color: mode === 'semantic' ? t.textAccent : t.success }}>
            {mode === 'semantic' ? 'AI Semantic' : 'Obsidian Folders'}
          </span>
          <span style={{ color: t.textDim }}>|</span>
          <span style={{ color: lodLevel === 'universe' ? '#c088ff' : lodLevel === 'note' ? '#88ffaa' : t.textAccent }}>
            {lodLevel}
          </span>
          <span style={{ color: t.textDim, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {clusters.map(c => c.label).join(' · ')}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={toggleHeatmap} title="Knowledge Heatmap" style={toggleBtnStyle(showHeatmap)}>
              Heatmap
            </button>
            <button onClick={toggleGaps} title="Knowledge Gaps" style={toggleBtnStyle(showGaps)}>
              Gaps
            </button>
            <ExportPanel />
            <select
              value={locale}
              onChange={(e) => {
                const l = e.target.value as 'en' | 'ko' | 'ja' | 'zh';
                setLocale(l);
                setUiLocale(l);
                window.location.reload();
              }}
              title="Language"
              style={{
                padding: '2px 4px',
                fontSize: '10px',
                background: 'transparent',
                border: `1px solid ${t.buttonBorder}`,
                borderRadius: '4px',
                color: t.textMuted,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="en">EN</option>
              <option value="ko">KO</option>
              <option value="ja">JA</option>
              <option value="zh">ZH</option>
            </select>
            <span style={{ color: t.textDim, fontSize: '10px' }}>
              ESC=reset · /=search
            </span>
          </div>
        </>
      )}
    </div>
  );
}
