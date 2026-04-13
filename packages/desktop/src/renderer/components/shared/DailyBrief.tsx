// Daily Brief — push-type knowledge review shown when no tabs are open.
// Sections: Today's Review (decaying notes), Vault Stats.
// Each note is clickable and opens in an editor tab.

import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { Button } from '../ui/Button.js';
import type { DecayItem, VaultStats } from '../../../shared/ipc-types.js';

interface BriefData {
  decayItems: DecayItem[];
  stats: VaultStats;
  loading: boolean;
  error: string | null;
}

function formatDate(iso: string): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function retrievabilityColor(r: number): string {
  if (r < 0.3) return '#ef4444'; // red — critical
  if (r < 0.5) return '#f59e0b'; // amber — warning
  return '#22c55e'; // green — ok
}

function retrievabilityLabel(r: number): string {
  if (r < 0.3) return 'Critical';
  if (r < 0.5) return 'Fading';
  if (r < 0.7) return 'Weakening';
  return 'Stable';
}

export function DailyBrief() {
  const coreReady = useAppStore((s) => s.coreReady);
  const openFile = useAppStore((s) => s.openFile);

  const [data, setData] = useState<BriefData>({
    decayItems: [],
    stats: { documentCount: 0, chunkCount: 0, dbSizeBytes: 0, lastIndexed: '' },
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!coreReady) return;

    let cancelled = false;

    async function load() {
      try {
        const [decayItems, stats] = await Promise.all([
          ipc('core:decay-top', 5),
          ipc('core:get-stats'),
        ]);
        if (!cancelled) {
          setData({ decayItems, stats, loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setData((prev) => ({ ...prev, loading: false, error: String(err) }));
        }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [coreReady]);

  const handleOpenNote = async (item: DecayItem) => {
    try {
      const content = await ipc('vault:read-file', item.filePath);
      openFile(item.filePath, item.title, content);
    } catch (err) {
      console.error('[DailyBrief] Failed to open note:', err);
    }
  };

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  if (!coreReady) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <span style={{ fontSize: 32, opacity: 0.4 }}>&#x2726;</span>
          <span style={{ color: 'var(--ink-faint)', fontSize: 13 }}>Initializing knowledge engine...</span>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={briefWrapperStyle}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={headingStyle}>{greeting}</h1>
          <p style={dateStyle}>{today}</p>
        </div>

        {/* Today's Review */}
        <section style={sectionStyle}>
          <h2 style={sectionTitleStyle}>
            <span style={{ marginRight: 8 }}>&#x25CB;</span>
            Today's Review
          </h2>
          {data.loading ? (
            <p style={mutedTextStyle}>Loading review items...</p>
          ) : data.decayItems.length === 0 ? (
            <div style={emptyCardStyle}>
              <p style={{ ...mutedTextStyle, margin: 0 }}>
                No notes need review right now. Your knowledge is fresh!
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.decayItems.slice(0, 3).map((item) => (
                <button
                  key={item.documentId}
                  onClick={() => void handleOpenNote(item)}
                  style={noteCardStyle}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--hover)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--surface)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={noteTitleStyle}>{item.title}</div>
                    <div style={noteMetaStyle}>
                      Last reviewed {formatDate(item.lastAccess)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: retrievabilityColor(item.retrievability),
                    }}>
                      {retrievabilityLabel(item.retrievability)}
                    </div>
                    <div style={{
                      fontSize: 10,
                      color: 'var(--ink-faint)',
                      marginTop: 2,
                    }}>
                      R: {(item.retrievability * 100).toFixed(0)}%
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Knowledge Gaps */}
        {data.decayItems.length > 3 && (
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>
              <span style={{ marginRight: 8 }}>&#x25CB;</span>
              Knowledge Gaps
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.decayItems.slice(3, 5).map((item) => (
                <button
                  key={item.documentId}
                  onClick={() => void handleOpenNote(item)}
                  style={noteCardStyle}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--hover)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--surface)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={noteTitleStyle}>{item.title}</div>
                    <div style={noteMetaStyle}>
                      Needs attention - {(item.retrievability * 100).toFixed(0)}% retention
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Vault Stats */}
        <section style={sectionStyle}>
          <h2 style={sectionTitleStyle}>
            <span style={{ marginRight: 8 }}>&#x25CB;</span>
            Vault Overview
          </h2>
          <div style={statsGridStyle}>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{data.stats.documentCount}</div>
              <div style={statLabelStyle}>Notes</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{data.stats.chunkCount}</div>
              <div style={statLabelStyle}>Chunks</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>
                {data.stats.dbSizeBytes > 0
                  ? `${(data.stats.dbSizeBytes / 1024 / 1024).toFixed(1)}MB`
                  : '--'}
              </div>
              <div style={statLabelStyle}>Index Size</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>
                {data.decayItems.length > 0
                  ? `${data.decayItems.length}`
                  : '0'}
              </div>
              <div style={statLabelStyle}>Need Review</div>
            </div>
          </div>
        </section>

        {/* Tip */}
        <div style={tipStyle}>
          Open a note from the sidebar, or press <kbd style={kbdStyle}>Ctrl+P</kbd> to quick-switch
        </div>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  background: 'var(--editor-bg)',
  overflow: 'auto',
  padding: '48px 24px',
};

const briefWrapperStyle: React.CSSProperties = {
  maxWidth: 560,
  width: '100%',
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: 48,
};

const headingStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 600,
  color: 'var(--ink)',
  margin: 0,
  lineHeight: 1.3,
};

const dateStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--ink-faint)',
  margin: '4px 0 0',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 24,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  margin: '0 0 10px',
  display: 'flex',
  alignItems: 'center',
};

const mutedTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--ink-faint)',
};

const emptyCardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '14px 16px',
};

const noteCardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
  width: '100%',
  textAlign: 'left',
  fontFamily: 'inherit',
  transition: 'all 0.15s',
  color: 'inherit',
};

const noteTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const noteMetaStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--ink-faint)',
  marginTop: 2,
};

const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 8,
};

const statCardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '12px 10px',
  textAlign: 'center',
};

const statValueStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--ink)',
  lineHeight: 1.2,
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--ink-faint)',
  marginTop: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const tipStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--ink-faint)',
  textAlign: 'center',
  marginTop: 16,
  opacity: 0.7,
};

const kbdStyle: React.CSSProperties = {
  background: 'var(--hover)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  padding: '1px 5px',
  fontSize: 10,
  fontFamily: 'inherit',
};
