// 대시보드 레이아웃 — 호버=툴팁, 클릭=사이드패널, 모션 제어

import { useState, useRef } from 'react';
import { Graph3D } from './Graph3D.js';
import { NodeDetail } from './NodeDetail.js';
import { StatusBar } from './StatusBar.js';
import { SearchBar } from './SearchBar.js';
import { ClusterFilter } from './ClusterFilter.js';
import { TypeFilter } from './TypeFilter.js';
import { Timeline } from './Timeline.js';
import { MotionToggle } from './MotionToggle.js';
import { MotionOverlay } from './MotionOverlay.js';
import { useMotion } from '../hooks/useMotion.js';
import { useGraphStore } from '../stores/graph-store.js';
import { ToolsPanel } from './ToolsPanel.js';
import { MultiverseView } from './MultiverseView.js';
import { FederationBadge } from './FederationBadge.js';
import { IngestPanel } from './IngestPanel.js';
import { QuickCapture } from './QuickCapture.js';
import { OnboardingGuide } from './OnboardingGuide.js';
import { t } from '../lib/i18n.js';

// Match the ONLY existing mobile breakpoint convention (IngestPanel.tsx:8). Computed once at
// module load — does not react to rotation (acceptable parity with IngestPanel).
const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

export function Layout() {
  // ALL hooks must be called before any conditional return
  const viewMode = useGraphStore((s) => s.viewMode);
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const error = useGraphStore((s) => s.error);
  const loading = useGraphStore((s) => s.loading);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const mode = useGraphStore((s) => s.mode);
  const setMode = useGraphStore((s) => s.setMode);
  const view = useGraphStore((s) => s.view);
  const setView = useGraphStore((s) => s.setView);
  const reloadGalaxy = useGraphStore((s) => s.reloadGalaxy);
  const theme = useGraphStore((s) => s.theme);
  const toggleTheme = useGraphStore((s) => s.toggleTheme);
  const showDecay = useGraphStore((s) => s.showDecayOverlay);
  const toggleDecay = useGraphStore((s) => s.toggleDecayOverlay);
  const showConstellation = useGraphStore((s) => s.showConstellation);
  const toggleConstellation = useGraphStore((s) => s.toggleConstellation);
  const showTimeline = useGraphStore((s) => s.showTimeline);
  const toggleTimeline = useGraphStore((s) => s.toggleTimeline);
  const isDark = theme === 'dark';

  // 모션 제어
  const controlsRef = useRef<any>(null);
  const getControls = () => (window as any).__sv_controls ?? controlsRef;
  const motion = useMotion(getControls());
  const [motionActive, setMotionActive] = useState(false);
  const [motionLoading, setMotionLoading] = useState(false);
  const [motionVideo, setMotionVideo] = useState<HTMLVideoElement | null>(null);

  const toggleMotion = async () => {
    if (motionActive) {
      motion.stop();
      setMotionActive(false);
      setMotionVideo(null);
    } else {
      setMotionLoading(true);
      try {
        await motion.start();
        setMotionActive(true);
        setMotionVideo(motion.videoRef.current);
      } catch (err) {
        console.error('Motion start failed:', err);
      }
      setMotionLoading(false);
    }
  };

  // [Cluster | All nodes] view toggle + '← All clusters' home affordance. Clones the
  // semantic/folder segmented-control look. Disabled while loading during a swap (spinner +
  // dimmed) so a tap during the multi-second cold build isn't silently swallowed.
  const viewToggle = (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <div style={{
        display: 'flex', gap: '2px',
        background: isDark ? 'rgba(100, 120, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
        borderRadius: '6px', padding: '2px',
        opacity: loading ? 0.5 : 1,
        pointerEvents: loading ? 'none' : 'auto',
      }}>
        {(['cluster', 'raw'] as const).map((v) => {
          const active = view === v;
          return (
            <button
              key={v}
              // Clicking the ALREADY-active 'cluster' while drilled into a cluster reloads the
              // galaxy (un-drills); otherwise just switch view. (Drilldown keeps view='cluster',
              // so a plain setView('cluster') would be a no-op and feel dead.)
              onClick={() => {
                if (loading) return;
                if (v === view) { if (v === 'cluster') reloadGalaxy(); }
                else setView(v);
              }}
              disabled={loading}
              style={{
                padding: '4px 12px', fontSize: '11px', border: 'none', borderRadius: '4px',
                cursor: loading ? 'default' : 'pointer',
                background: active
                  ? (isDark ? 'rgba(100, 120, 255, 0.3)' : 'rgba(0, 0, 0, 0.08)')
                  : 'transparent',
                color: active ? (isDark ? '#c0d0ff' : '#2a2a4a') : (isDark ? '#556' : '#888'),
                fontWeight: active ? 600 : 400,
              }}
            >
              {v === 'cluster' ? t('btn.clusterView') : t('btn.allNodes')}
            </button>
          );
        })}
      </div>
      {loading && (
        <span style={{
          width: '10px', height: '10px', borderRadius: '50%',
          border: `2px solid ${isDark ? 'rgba(120,140,255,0.3)' : 'rgba(0,0,0,0.2)'}`,
          borderTopColor: isDark ? '#88aaff' : '#4466aa',
          display: 'inline-block', animation: 'sv-spin 0.7s linear infinite',
        }} />
      )}
      {/* Single home affordance — re-fetch the galaxy (also resets drilldown). */}
      <button
        onClick={() => { if (!loading) reloadGalaxy(); }}
        disabled={loading}
        title={t('btn.allClusters')}
        style={{
          padding: '4px 8px', fontSize: '11px',
          border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
          borderRadius: '4px', cursor: loading ? 'default' : 'pointer',
          background: isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.03)',
          color: isDark ? '#aab' : '#555', opacity: loading ? 0.5 : 1,
        }}
      >
        ← {t('btn.allClusters')}
      </button>
    </div>
  );

  // 멀티버스 모드면 멀티버스 뷰 렌더링
  if (viewMode === 'multiverse') {
    return <MultiverseView />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: isDark ? '#050510' : '#f0f2f8' }}>
      {/* Header */}
      <div style={{
        padding: '8px 16px',
        background: isDark ? 'rgba(10, 10, 20, 0.8)' : 'rgba(240, 242, 248, 0.95)',
        borderBottom: `1px solid ${isDark ? 'rgba(100, 120, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)'}`,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        backdropFilter: 'blur(8px)',
        position: 'relative',
        zIndex: 10,
      }}>
        <button
          onClick={() => setViewMode('multiverse')}
          style={{
            padding: '4px 10px', fontSize: '11px', border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
            borderRadius: '4px', cursor: 'pointer',
            background: isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.03)',
            color: isDark ? '#88aaff' : '#4466aa',
          }}
        >
          {t('btn.multiverse')}
        </button>
        <FederationBadge isDark={isDark} />
        <span style={{ fontSize: '14px', fontWeight: 600, color: isDark ? '#c0c0f0' : '#2a2a4a', letterSpacing: '0.5px' }}>
          {t('title')}
        </span>
        <span style={{ color: isDark ? 'rgba(100, 120, 255, 0.5)' : 'rgba(60, 60, 120, 0.5)', fontSize: '12px', marginRight: '12px' }}>
          {t('subtitle')}
        </span>
        <SearchBar />
        <div style={{
          marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center',
        }}>
          {/* Desktop: view toggle top-right in header. Mobile: relocated to a fixed
              bottom-center pill below (above the StatusBar). */}
          {!isMobile && viewToggle}
          <MotionToggle active={motionActive} loading={motionLoading} onToggle={toggleMotion} isDark={isDark} />
          <div style={{
            display: 'flex', gap: '2px',
            background: isDark ? 'rgba(100, 120, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
            borderRadius: '6px', padding: '2px',
          }}>
            {(['semantic', 'folder'] as const).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    padding: '4px 12px', fontSize: '11px', border: 'none', borderRadius: '4px', cursor: 'pointer',
                    background: active
                      ? (isDark ? 'rgba(100, 120, 255, 0.3)' : 'rgba(0, 0, 0, 0.08)')
                      : 'transparent',
                    color: active
                      ? (isDark ? '#c0d0ff' : '#2a2a4a')
                      : (isDark ? '#556' : '#888'),
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {m === 'semantic' ? t('btn.semantic') : t('btn.folders')}
                </button>
              );
            })}
          </div>
          <button
            onClick={toggleConstellation}
            style={{
              padding: '4px 8px', fontSize: '11px',
              border: `1px solid ${showConstellation ? (isDark ? 'rgba(100,200,255,0.3)' : 'rgba(0,100,200,0.2)') : (isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.12)')}`,
              borderRadius: '4px', cursor: 'pointer',
              background: showConstellation ? (isDark ? 'rgba(100,200,255,0.15)' : 'rgba(0,100,200,0.08)') : (isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.03)'),
              color: showConstellation ? (isDark ? '#66ccff' : '#0066aa') : (isDark ? '#aab' : '#555'),
            }}
          >
            {t('btn.stars')}
          </button>
          <ClusterFilter />
          <TypeFilter />
          <button
            onClick={toggleTimeline}
            style={{
              padding: '4px 8px', fontSize: '11px',
              border: `1px solid ${showTimeline ? (isDark ? 'rgba(100,180,255,0.3)' : 'rgba(0,100,200,0.2)') : (isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.12)')}`,
              borderRadius: '4px', cursor: 'pointer',
              background: showTimeline ? (isDark ? 'rgba(100,180,255,0.15)' : 'rgba(0,100,200,0.08)') : (isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.03)'),
              color: showTimeline ? (isDark ? '#66aaff' : '#0066aa') : (isDark ? '#aab' : '#555'),
            }}
          >
            {t('btn.timeline')}
          </button>
          <button
            onClick={toggleDecay}
            style={{
              padding: '4px 8px', fontSize: '11px',
              border: `1px solid ${showDecay ? (isDark ? 'rgba(255,150,50,0.3)' : 'rgba(200,100,0,0.2)') : (isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.12)')}`,
              borderRadius: '4px', cursor: 'pointer',
              background: showDecay ? (isDark ? 'rgba(255,150,50,0.15)' : 'rgba(200,100,0,0.08)') : (isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.03)'),
              color: showDecay ? (isDark ? '#ffaa44' : '#aa6600') : (isDark ? '#aab' : '#555'),
            }}
          >
            {t('btn.decay')}
          </button>
          <button
            onClick={toggleTheme}
            style={{
              padding: '4px 8px', fontSize: '11px',
              border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
              borderRadius: '4px', cursor: 'pointer',
              background: isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.03)',
              color: isDark ? '#aab' : '#555',
            }}
          >
            {isDark ? t('btn.light') : t('btn.dark')}
          </button>
        </div>
        {loading && (
          <span style={{ fontSize: '11px', color: '#88aaff' }}>
            {view === 'cluster'
              ? 'Folding into galaxy...'
              : (mode === 'semantic' ? 'Loading all nodes...' : 'Loading folder structure...')}
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 16px', background: 'rgba(255, 50, 50, 0.1)', color: '#ef4444', fontSize: '12px' }}>
          {error}
        </div>
      )}

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Graph3D />
          {/* 모션 웹캠 PIP */}
          {motionActive && (
            <MotionOverlay videoElement={motionVideo} currentGesture={motion.currentGesture} />
          )}
        </div>
        {selectedNodeId && <NodeDetail />}
      </div>

      <Timeline />
      <ToolsPanel />
      <StatusBar />
      <IngestPanel />
      <QuickCapture />
      <OnboardingGuide />

      {/* Mobile: fixed bottom-center pill ABOVE the StatusBar (bottom:44px ≈ StatusBar height
          + gap). zIndex:50 keeps it over the full-bleed R3F canvas (which only acts when
          canvas.contains(e.target), so an overlaid fixed div is safe from tap capture). May
          overlap the IngestPanel bottom-sheet when that is open — both are user-toggled. */}
      {isMobile && (
        <div style={{
          position: 'fixed', bottom: '44px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 50,
          padding: '4px', borderRadius: '8px',
          background: isDark ? 'rgba(10,10,20,0.92)' : 'rgba(255,255,255,0.95)',
          border: `1px solid ${isDark ? 'rgba(100,120,255,0.2)' : 'rgba(0,0,0,0.1)'}`,
          backdropFilter: 'blur(8px)',
          boxShadow: isDark ? 'none' : '0 2px 12px rgba(0,0,0,0.12)',
        }}>
          {viewToggle}
        </div>
      )}

      <style>{`@keyframes sv-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
