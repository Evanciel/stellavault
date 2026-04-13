// Custom frameless title bar with drag region + window controls.

import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';

export function TitleBar() {
  const theme = useAppStore((s) => s.theme);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';
  const isMac = window.stellavault.platform === 'darwin';

  return (
    <div style={{
      height: 38,
      background: 'var(--tab-bg)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      WebkitAppRegion: 'drag' as never,
      paddingLeft: isMac ? 78 : 12,
      paddingRight: 8,
      gap: 8,
      fontSize: '12px',
    }}>
      <button onClick={toggleSidebar} style={btnStyle(isDark)} title="Toggle sidebar">
        <span style={{ fontSize: 14, lineHeight: 1 }}>&#9776;</span>
      </button>

      <span style={{
        flex: 1,
        textAlign: 'center',
        color: 'var(--ink-dim)',
        fontSize: '11px',
        letterSpacing: '0.5px',
        WebkitAppRegion: 'drag' as never,
      }}>
        Stellavault
      </span>

      <button onClick={toggleTheme} style={btnStyle(isDark)} title="Toggle theme">
        {isDark ? '\u263C' : '\u263E'}
      </button>

      {!isMac && (
        <>
          <button onClick={() => void ipc('window:minimize')} style={btnStyle(isDark)} title="Minimize">&#x2014;</button>
          <button onClick={() => void ipc('window:maximize')} style={btnStyle(isDark)} title="Maximize">&#x25A1;</button>
          <button onClick={() => void ipc('window:close')} style={{ ...btnStyle(isDark), color: '#ef4444' }} title="Close">&#x2715;</button>
        </>
      )}
    </div>
  );
}

function btnStyle(isDark: boolean): React.CSSProperties {
  return {
    WebkitAppRegion: 'no-drag' as never,
    background: 'transparent',
    border: 'none',
    color: isDark ? '#8a8aa0' : '#666',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 13,
  };
}
