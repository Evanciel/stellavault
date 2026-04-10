// Federation status badge for the My Universe header.
// Replaces the old hidden button on MultiverseView: persistent, toggleable,
// shows peer count, degrades gracefully when hyperswarm is unavailable.

import { useEffect, useState, useRef, useCallback } from 'react';

interface FederationStatus {
  available: boolean;
  active: boolean;
  peerCount: number;
  peers: Array<{ peerId: string; displayName: string; documentCount: number; topTopics: string[] }>;
  displayName: string | null;
  peerId: string | null;
}

interface Props {
  isDark: boolean;
}

const INITIAL: FederationStatus = {
  available: true, // optimistic until probed
  active: false,
  peerCount: 0,
  peers: [],
  displayName: null,
  peerId: null,
};

export function FederationBadge({ isDark }: Props) {
  const [status, setStatus] = useState<FederationStatus>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/federate/status');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setStatus(data);
      setError(null);
    } catch {
      // API server missing the endpoint or network down — show as unavailable
      setStatus({ ...INITIAL, available: false });
    }
  }, []);

  // Poll status every 10s when active so peer count stays fresh
  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 10000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const handleJoin = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/federate/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (!data.success) {
        setError(data.message || data.error || 'Join failed');
      } else {
        await fetchStatus();
      }
    } catch (err: any) {
      setError(err?.message || 'Network error');
    }
    setLoading(false);
  };

  const handleLeave = async () => {
    setLoading(true);
    setError(null);
    try {
      await fetch('/api/federate/leave', { method: 'POST' });
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message || 'Leave failed');
    }
    setLoading(false);
    setMenuOpen(false);
  };

  // Colors
  const activeGreen = isDark ? '#4ade80' : '#16a34a';
  const dimGray = isDark ? '#556' : '#888';
  const accentIdle = isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.12)';
  const accentActive = isDark ? 'rgba(74,222,128,0.3)' : 'rgba(22,163,74,0.25)';

  // Unavailable state — no hyperswarm
  if (!status.available) {
    return (
      <div
        title="Federation unavailable — hyperswarm not installed"
        style={{
          padding: '4px 10px',
          fontSize: '11px',
          border: `1px dashed ${accentIdle}`,
          borderRadius: '4px',
          background: 'transparent',
          color: dimGray,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          cursor: 'not-allowed',
          userSelect: 'none',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dimGray, opacity: 0.5 }} />
        P2P N/A
      </div>
    );
  }

  // Connecting / loading
  if (loading) {
    return (
      <div
        style={{
          padding: '4px 10px',
          fontSize: '11px',
          border: `1px solid ${accentIdle}`,
          borderRadius: '4px',
          background: isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.03)',
          color: isDark ? '#88aaff' : '#4466aa',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#88aaff', animation: 'sv-pulse 1s ease-in-out infinite' }} />
        Connecting…
        <style>{`@keyframes sv-pulse { 0%,100% { opacity:0.4; } 50% { opacity:1; } }`}</style>
      </div>
    );
  }

  // Idle (not connected)
  if (!status.active) {
    return (
      <button
        onClick={handleJoin}
        title="Join Stella Network — share embeddings, never raw text"
        style={{
          padding: '4px 10px',
          fontSize: '11px',
          border: `1px solid ${accentIdle}`,
          borderRadius: '4px',
          background: isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.03)',
          color: isDark ? '#aab' : '#555',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dimGray }} />
        Offline
        <span style={{ color: isDark ? '#88aaff' : '#4466aa', fontWeight: 500 }}>· Join</span>
      </button>
    );
  }

  // Active (connected)
  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        title={`Connected to Stella Network as ${status.displayName ?? 'Stella'} — click for options`}
        style={{
          padding: '4px 10px',
          fontSize: '11px',
          border: `1px solid ${accentActive}`,
          borderRadius: '4px',
          background: isDark ? 'rgba(74,222,128,0.08)' : 'rgba(22,163,74,0.08)',
          color: activeGreen,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontWeight: 500,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: activeGreen,
            boxShadow: `0 0 8px ${activeGreen}`,
            animation: 'sv-peer-pulse 2.4s ease-in-out infinite',
          }}
        />
        {status.peerCount} {status.peerCount === 1 ? 'peer' : 'peers'}
        <style>{`@keyframes sv-peer-pulse { 0%,100% { opacity:0.7; } 50% { opacity:1; } }`}</style>
      </button>

      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 240,
            background: isDark ? 'rgba(10,14,28,0.97)' : 'rgba(255,255,255,0.98)',
            border: `1px solid ${isDark ? 'rgba(100,120,255,0.25)' : 'rgba(0,0,0,0.12)'}`,
            borderRadius: '8px',
            boxShadow: isDark
              ? '0 10px 30px rgba(0,0,0,0.6), 0 0 0 1px rgba(100,120,255,0.08)'
              : '0 10px 30px rgba(0,0,0,0.15)',
            padding: '12px 14px',
            fontSize: '11px',
            color: isDark ? '#c0c0f0' : '#2a2a4a',
            zIndex: 100,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: '12px', color: activeGreen }}>● Connected</strong>
            <span style={{ fontSize: '10px', color: dimGray }}>Stella Network</span>
          </div>

          <div style={{ marginBottom: 10, color: isDark ? '#8898c0' : '#555' }}>
            You: <strong style={{ color: isDark ? '#c0c0f0' : '#2a2a4a' }}>{status.displayName ?? 'Anonymous'}</strong>
          </div>

          {status.peers.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: '10px', color: dimGray, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Peers ({status.peers.length})
              </div>
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                {status.peers.map((p) => (
                  <div
                    key={p.peerId}
                    style={{
                      padding: '6px 0',
                      borderBottom: `1px solid ${isDark ? 'rgba(100,120,255,0.08)' : 'rgba(0,0,0,0.05)'}`,
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{p.displayName}</span>
                    <span style={{ color: dimGray }}>{p.documentCount} docs</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ padding: '8px 0 12px', color: dimGray, fontStyle: 'italic' }}>
              Waiting for peers to join…
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, paddingTop: 8, borderTop: `1px solid ${isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.08)'}` }}>
            <button
              onClick={handleLeave}
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '11px',
                border: `1px solid ${isDark ? 'rgba(255,100,100,0.25)' : 'rgba(200,50,50,0.2)'}`,
                borderRadius: '4px',
                background: 'transparent',
                color: isDark ? '#ff8888' : '#cc3333',
                cursor: 'pointer',
              }}
            >
              Disconnect
            </button>
          </div>

          <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${isDark ? 'rgba(100,120,255,0.08)' : 'rgba(0,0,0,0.05)'}`, fontSize: '10px', color: dimGray, lineHeight: 1.5 }}>
            Only embeddings shared — never raw text.
          </div>

          {error && (
            <div style={{ marginTop: 8, fontSize: '10px', color: '#ef4444' }}>{error}</div>
          )}
        </div>
      )}
    </div>
  );
}
