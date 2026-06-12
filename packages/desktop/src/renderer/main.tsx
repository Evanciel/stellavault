import { Component } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './lib/runtime-sync.js'; // Stage C: FSRS access tracking + file:changed sync (side-effect)
import './lib/session-persist.js'; // Stage D: session restore/persist + W1-10/11/17 commands (side-effect)

// Root error boundary — a crash anywhere in the tree must never leave the user
// staring at a blank window (observed once via React #185 after a force-kill
// left stale state behind). Offers a reload instead.
class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[root] render crash:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
          background: 'var(--bg-1, #0a0a0f)', color: 'var(--ink, #e0e0f0)',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Something went wrong</div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint, #4a4a60)', maxWidth: 480, textAlign: 'center' }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '6px 18px', fontSize: 13, borderRadius: 6, border: 'none',
              cursor: 'pointer', background: 'var(--accent, #6366f1)', color: '#fff',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
);
