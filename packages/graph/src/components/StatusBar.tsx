import { useGraphStore } from '../stores/graph-store.js';
import { ExportPanel } from './ExportPanel.js';
import { getTheme } from '../lib/theme.js';
import { t, setUiLocale } from '../lib/i18n.js';

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

  const th = getTheme(themeMode);

  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
    border: `1px solid ${active ? 'rgba(239, 68, 68, 0.4)' : th.buttonBorder}`,
    color: active ? th.danger : th.textMuted,
    borderRadius: '4px',
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: '10px',
    transition: 'all 0.15s ease',
  });

  return (
    <div style={{
      padding: '6px 16px',
      background: th.bg,
      borderTop: `1px solid ${th.border}`,
      fontSize: '11px',
      color: th.textMuted,
      display: 'flex',
      gap: '20px',
      alignItems: 'center',
      transition: 'background 0.3s ease, color 0.3s ease',
    }}>
      {loading ? (
        <span>Loading...</span>
      ) : (
        <>
          <span>{nodes.length} {t('status.docs')}</span>
          <span>{edges.length} {t('status.edges')}</span>
          <span>{clusters.length} {t('status.clusters')}</span>
          <span style={{ color: th.textDim }}>|</span>
          <span style={{ color: mode === 'semantic' ? th.textAccent : th.success }}>
            {mode === 'semantic' ? t('btn.semantic') : t('btn.folders')}
          </span>
          <span style={{ color: th.textDim }}>|</span>
          <span style={{ color: lodLevel === 'universe' ? '#c088ff' : lodLevel === 'note' ? '#88ffaa' : th.textAccent }}>
            {lodLevel}
          </span>
          <span style={{ color: th.textDim, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {clusters.map(c => c.label).join(' · ')}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={toggleHeatmap} title={t('btn.heatmap')} style={toggleBtnStyle(showHeatmap)}>
              {t('btn.heatmap')}
            </button>
            <button onClick={toggleGaps} title={t('btn.gaps')} style={toggleBtnStyle(showGaps)}>
              {t('btn.gaps')}
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
                padding: '2px 4px', fontSize: '10px', background: 'transparent',
                border: `1px solid ${th.buttonBorder}`, borderRadius: '4px',
                color: th.textMuted, cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="en">EN</option>
              <option value="ko">KO</option>
              <option value="ja">JA</option>
              <option value="zh">ZH</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}
