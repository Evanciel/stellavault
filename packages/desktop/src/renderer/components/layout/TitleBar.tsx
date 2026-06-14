// Custom frameless title bar with drag region + window controls.

import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { AppMenu } from './AppMenu.js';
import { VaultSwitcher } from './VaultSwitcher.js';

// Electron-only CSS property for frameless-window drag regions.
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}

export function TitleBar() {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const rightPanel = useAppStore((s) => s.rightPanel);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const openGraphTab = useAppStore((s) => s.openGraphTab);
  const isDark = theme === 'dark';
  const isMac = window.stellavault.platform === 'darwin';

  return (
    <div style={{
      height: 38,
      background: 'var(--tab-bg)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      WebkitAppRegion: 'drag',
      paddingLeft: isMac ? 78 : 12,
      paddingRight: 8,
      gap: 8,
      fontSize: '12px',
      userSelect: 'none' as const,
    }}>
      {/* App menu (W2) — hamburger now opens the application menu; sidebar
          toggle lives in View menu (+ its hotkey). */}
      <AppMenu />

      {/* T3-9: vault switcher — pick / add registered vaults (restart to load). */}
      <VaultSwitcher />

      <span style={{
        flex: 1,
        textAlign: 'center',
        color: 'var(--ink-dim)',
        fontSize: '11px',
        letterSpacing: '0.5px',
        WebkitAppRegion: 'drag',
      }}>
        Stellavault
      </span>

      {/* Stage C (W1-4/5/6) panel toggles */}
      <button
        onClick={() => setRightPanel(rightPanel === 'search' ? 'none' : 'search')}
        style={{ ...btnStyle(isDark), color: rightPanel === 'search' ? 'var(--accent-2)' : undefined }}
        title="Search" aria-label="Toggle search panel"
      >
        &#x2315;
      </button>
      <button
        onClick={() => setRightPanel(rightPanel === 'outline' ? 'none' : 'outline')}
        style={{ ...btnStyle(isDark), color: rightPanel === 'outline' ? 'var(--accent-2)' : undefined }}
        title="Outline" aria-label="Toggle outline panel"
      >
        &#x2261;
      </button>
      <button
        onClick={() => setRightPanel(rightPanel === 'tags' ? 'none' : 'tags')}
        style={{ ...btnStyle(isDark), color: rightPanel === 'tags' ? 'var(--accent-2)' : undefined }}
        title="Tags" aria-label="Toggle tags panel"
      >
        #
      </button>
      {/* Wave 2: ◉ now opens the full-pane graph TAB (the side panel graph
          stays available via the 'panel.graph' command / panel menu). */}
      <button
        onClick={openGraphTab}
        style={btnStyle(isDark)}
        title="Open graph view (Ctrl+G)" aria-label="Open graph view"
      >
        &#x25C9;
      </button>
      <button
        onClick={() => setRightPanel(rightPanel === 'ai' ? 'none' : 'ai')}
        style={{ ...btnStyle(isDark), color: rightPanel === 'ai' ? 'var(--accent-2)' : undefined }}
        title="AI panel" aria-label="Toggle AI panel"
      >
        &#x2726;
      </button>
      <button
        onClick={() => setRightPanel(rightPanel === 'backlinks' ? 'none' : 'backlinks')}
        style={{ ...btnStyle(isDark), color: rightPanel === 'backlinks' ? 'var(--accent-2)' : undefined }}
        title="Backlinks" aria-label="Toggle backlinks panel"
      >
        &#x21C4;
      </button>
      {/* T2-6: Coach — gaps + learning path (the dormant FSRS/gap differentiators). */}
      <button
        onClick={() => setRightPanel(rightPanel === 'coach' ? 'none' : 'coach')}
        style={{ ...btnStyle(isDark), color: rightPanel === 'coach' ? 'var(--accent-2)' : undefined }}
        title="Coach — knowledge gaps + learning path" aria-label="Toggle Coach panel"
      >
        &#x2316;
      </button>
      {/* T3-1: Synthesize — compile a cited article from your vault. */}
      <button
        onClick={() => setRightPanel(rightPanel === 'synthesis' ? 'none' : 'synthesis')}
        style={{ ...btnStyle(isDark), color: rightPanel === 'synthesis' ? 'var(--accent-2)' : undefined }}
        title="Synthesize — compile a cited article from your vault" aria-label="Toggle Synthesis panel"
      >
        &#x2726;
      </button>
      <button onClick={toggleTheme} style={btnStyle(isDark)} title="Toggle theme" aria-label="Toggle dark/light theme">
        {isDark ? '\u263C' : '\u263E'}
      </button>

      {!isMac && (
        <>
          <button onClick={() => void ipc('window:minimize')} style={btnStyle(isDark)} title="Minimize" aria-label="Minimize window">&#x2014;</button>
          <button onClick={() => void ipc('window:maximize')} style={btnStyle(isDark)} title="Maximize" aria-label="Maximize window">&#x25A1;</button>
          <button onClick={() => void ipc('window:close')} style={{ ...btnStyle(isDark), color: '#ef4444' }} title="Close" aria-label="Close window">&#x2715;</button>
        </>
      )}
    </div>
  );
}

function btnStyle(isDark: boolean): React.CSSProperties {
  return {
    WebkitAppRegion: 'no-drag',
    background: 'transparent',
    border: 'none',
    color: isDark ? '#8a8aa0' : '#666',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 13,
  };
}
