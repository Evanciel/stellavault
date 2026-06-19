// Custom frameless title bar with drag region + window controls.

import { useAppStore } from '../../stores/app-store.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { useT } from '../../lib/i18n.js';
import { AppMenu } from './AppMenu.js';
import { VaultSwitcher } from './VaultSwitcher.js';

// Electron-only CSS property for frameless-window drag regions.
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}

export function TitleBar() {
  const t = useT();
  const theme = useAppStore((s) => s.theme);
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
        style={{ ...btnStyle(), color: rightPanel === 'search' ? 'var(--accent-2)' : 'var(--ink)' }}
        title="Search" aria-label={t('titlebar.search')}
      >
        &#x2315;
      </button>
      <button
        onClick={() => setRightPanel(rightPanel === 'outline' ? 'none' : 'outline')}
        style={{ ...btnStyle(), color: rightPanel === 'outline' ? 'var(--accent-2)' : 'var(--ink)' }}
        title="Outline" aria-label={t('titlebar.outline')}
      >
        &#x2261;
      </button>
      <button
        onClick={() => setRightPanel(rightPanel === 'tags' ? 'none' : 'tags')}
        style={{ ...btnStyle(), color: rightPanel === 'tags' ? 'var(--accent-2)' : 'var(--ink)' }}
        title="Tags" aria-label={t('titlebar.tags')}
      >
        #
      </button>
      {/* Wave 2: ◉ now opens the full-pane graph TAB (the side panel graph
          stays available via the 'panel.graph' command / panel menu). */}
      <button
        onClick={openGraphTab}
        style={btnStyle()}
        title={t('titlebar.openGraphView')} aria-label="Open graph view"
      >
        &#x25C9;
      </button>
      <button
        onClick={() => setRightPanel(rightPanel === 'ai' ? 'none' : 'ai')}
        style={{ ...btnStyle(), color: rightPanel === 'ai' ? 'var(--accent-2)' : 'var(--ink)' }}
        title="AI panel" aria-label={t('titlebar.aiPanel')}
      >
        &#x2726;
      </button>
      <button
        onClick={() => setRightPanel(rightPanel === 'backlinks' ? 'none' : 'backlinks')}
        style={{ ...btnStyle(), color: rightPanel === 'backlinks' ? 'var(--accent-2)' : 'var(--ink)' }}
        title="Backlinks" aria-label={t('titlebar.backlinks')}
      >
        &#x21C4;
      </button>
      {/* T2-6: Coach — gaps + learning path (the dormant FSRS/gap differentiators). */}
      <button
        onClick={() => setRightPanel(rightPanel === 'coach' ? 'none' : 'coach')}
        style={{ ...btnStyle(), color: rightPanel === 'coach' ? 'var(--accent-2)' : 'var(--ink)' }}
        title={t('titlebar.coach')} aria-label="Toggle Coach panel"
      >
        &#x2316;
      </button>
      {/* T3-1: Synthesize — compile a cited article from your vault. */}
      <button
        onClick={() => setRightPanel(rightPanel === 'synthesis' ? 'none' : 'synthesis')}
        style={{ ...btnStyle(), color: rightPanel === 'synthesis' ? 'var(--accent-2)' : 'var(--ink)' }}
        title={t('titlebar.synthesis')} aria-label="Toggle Synthesis panel"
      >
        &#x2726;
      </button>
      <button onClick={() => void useSettingsStore.getState().update({ theme: isDark ? 'light' : 'dark' })} style={btnStyle()} title="Toggle theme" aria-label={t('action.toggleThemeDarkLight')}>
        {isDark ? '\u263C' : '\u263E'}
      </button>

      {!isMac && (
        <>
          <button onClick={() => void ipc('window:minimize')} style={btnStyle()} title={t('titlebar.minimize')} aria-label="Minimize window">&#x2014;</button>
          <button onClick={() => void ipc('window:maximize')} style={btnStyle()} title={t('titlebar.maximize')} aria-label="Maximize window">&#x25A1;</button>
          <button onClick={() => void ipc('window:close')} style={{ ...btnStyle(), color: '#ef4444' }} title={t('titlebar.close')} aria-label="Close window">&#x2715;</button>
        </>
      )}
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    WebkitAppRegion: 'no-drag',
    background: 'transparent',
    border: 'none',
    // Theme-adaptive via data-theme (always correct). Use the FULL-strength ink
    // (not --ink-dim) — at #8a8aa0 the icons were technically rendered but too faint
    // to see on the near-black titlebar; --ink (#e0e0f0 dark / #1a1a2e light) reads clearly.
    color: 'var(--ink)',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 13,
  };
}
