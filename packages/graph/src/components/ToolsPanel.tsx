// Intelligence Tools 패널 — Gaps, Duplicates, Clip, Review 통합 UI

import { useState } from 'react';
import { useGraphStore } from '../stores/graph-store.js';
import { HealthDashboard } from './HealthDashboard.js';

interface GapData {
  clusterA: string; clusterB: string; bridgeCount: number;
  suggestedTopic: string; severity: string;
}

interface DuplicatePair {
  docA: { id: string; title: string; filePath: string };
  docB: { id: string; title: string; filePath: string };
  similarity: number;
}

interface DecayNote {
  documentId: string; title: string; retrievability: number;
  stability: number; daysSinceAccess: number;
}

type Tab = 'gaps' | 'duplicates' | 'decay' | 'clip' | 'sync' | 'health';

export function ToolsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('gaps');
  const [loading, setLoading] = useState(false);

  // Data states
  const [gaps, setGaps] = useState<GapData[]>([]);
  const [isolatedCount, setIsolatedCount] = useState(0);
  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([]);
  const [decayNotes, setDecayNotes] = useState<DecayNote[]>([]);
  const [clipUrl, setClipUrl] = useState('');
  const [clipStatus, setClipStatus] = useState('');
  const [syncStatus, setSyncStatus] = useState('');

  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';

  const bg = isDark ? 'rgba(10, 12, 28, 0.95)' : 'rgba(255, 255, 255, 0.97)';
  const border = isDark ? 'rgba(100, 120, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)';
  const textPrimary = isDark ? '#c0c0f0' : '#2a2a4a';
  const textSecondary = isDark ? '#667' : '#888';
  const btnBg = isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.04)';
  const btnBorder = isDark ? 'rgba(100,120,255,0.2)' : 'rgba(0,0,0,0.1)';

  async function loadGaps() {
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/gaps');
      const data = await res.json();
      setGaps(data.gaps ?? []);
      setIsolatedCount(data.isolatedNodes?.length ?? 0);
    } catch { setGaps([]); }
    setLoading(false);
  }

  async function loadDuplicates() {
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/duplicates');
      const data = await res.json();
      setDuplicates(data.pairs ?? []);
    } catch { setDuplicates([]); }
    setLoading(false);
  }

  async function loadDecay() {
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/decay');
      const data = await res.json();
      setDecayNotes(data.topDecaying ?? []);
    } catch { setDecayNotes([]); }
    setLoading(false);
  }

  function handleTabClick(t: Tab) {
    setTab(t);
    if (t === 'gaps' && gaps.length === 0) loadGaps();
    if (t === 'duplicates' && duplicates.length === 0) loadDuplicates();
    if (t === 'decay' && decayNotes.length === 0) loadDecay();
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => { setIsOpen(true); handleTabClick('gaps'); }}
        style={{
          position: 'fixed', left: '16px', bottom: '40px',
          background: btnBg, border: `1px solid ${btnBorder}`,
          borderRadius: '8px', padding: '8px 14px',
          color: textPrimary, fontSize: '11px', cursor: 'pointer',
          zIndex: 100, backdropFilter: 'blur(8px)',
          boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        Intelligence
      </button>
    );
  }

  const tabStyle = (t: Tab) => ({
    padding: '4px 10px', fontSize: '10px', border: 'none', borderRadius: '4px',
    cursor: 'pointer' as const,
    background: tab === t ? (isDark ? 'rgba(100,120,255,0.2)' : 'rgba(0,0,0,0.08)') : 'transparent',
    color: tab === t ? textPrimary : textSecondary,
    fontWeight: tab === t ? 600 : 400 as any,
  });

  const severityIcon = (s: string) => s === 'high' ? '🔴' : s === 'medium' ? '🟡' : '🟢';

  return (
    <div style={{
      position: 'fixed', left: '16px', bottom: '40px',
      width: '340px', maxHeight: '70vh',
      background: bg, border: `1px solid ${border}`,
      borderRadius: '10px', zIndex: 100,
      backdropFilter: 'blur(12px)',
      boxShadow: isDark ? 'none' : '0 4px 20px rgba(0,0,0,0.08)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', borderBottom: `1px solid ${border}`,
      }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: textPrimary }}>
          Intelligence
        </span>
        <button onClick={() => setIsOpen(false)} style={{
          background: 'none', border: 'none', color: textSecondary,
          cursor: 'pointer', fontSize: '14px',
        }}>x</button>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: '2px', padding: '6px 10px',
        borderBottom: `1px solid ${border}`,
      }}>
        <button onClick={() => handleTabClick('gaps')} style={tabStyle('gaps')}>Gaps</button>
        <button onClick={() => handleTabClick('duplicates')} style={tabStyle('duplicates')}>Duplicates</button>
        <button onClick={() => handleTabClick('decay')} style={tabStyle('decay')}>Decay</button>
        <button onClick={() => handleTabClick('clip')} style={tabStyle('clip')}>Clip</button>
        <button onClick={() => setTab('sync')} style={tabStyle('sync')}>Sync</button>
        <button onClick={() => setTab('health')} style={tabStyle('health')}>Health</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {loading && <div style={{ color: textSecondary, fontSize: '11px' }}>Loading...</div>}

        {/* Gaps Tab */}
        {tab === 'gaps' && !loading && (
          <div>
            <div style={{ fontSize: '10px', color: textSecondary, marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span>{gaps.length}개 갭 | {isolatedCount}개 고립 노드</span>
              <span>
                <button onClick={() => autoCreateBridges()} style={{
                  background: 'none', border: 'none',
                  color: isDark ? '#10b981' : '#047857', cursor: 'pointer', fontSize: '10px',
                }}>전체 자동 생성</button>
                <button onClick={loadGaps} style={{
                  marginLeft: '6px', background: 'none', border: 'none',
                  color: isDark ? '#88aaff' : '#4466aa', cursor: 'pointer', fontSize: '10px',
                }}>새로고침</button>
              </span>
            </div>
            {gaps.map((g, i) => (
              <div key={i} style={{
                padding: '6px 8px', marginBottom: '4px', borderRadius: '4px',
                background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                fontSize: '11px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: textPrimary }}>
                    {severityIcon(g.severity)} {g.clusterA.replace(/\s*\(\d+\)$/, '')} ↔ {g.clusterB.replace(/\s*\(\d+\)$/, '')}
                  </span>
                  <button onClick={() => createGapNote(g)} style={{
                    background: 'none', border: 'none', color: isDark ? '#88aaff' : '#4466aa',
                    cursor: 'pointer', fontSize: '9px',
                  }}>노트 생성</button>
                </div>
                <div style={{ color: textSecondary, fontSize: '10px', marginTop: '2px' }}>
                  연결 {g.bridgeCount}개 · {g.suggestedTopic}
                </div>
              </div>
            ))}
            {gaps.length === 0 && <div style={{ color: textSecondary, fontSize: '11px' }}>갭이 없습니다!</div>}
          </div>
        )}

        {/* Duplicates Tab */}
        {tab === 'duplicates' && !loading && (
          <div>
            <div style={{ fontSize: '10px', color: textSecondary, marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span>{duplicates.length}쌍 발견</span>
              <span>
                <button onClick={loadDuplicates} style={{
                  background: 'none', border: 'none',
                  color: isDark ? '#88aaff' : '#4466aa', cursor: 'pointer', fontSize: '10px',
                }}>새로고침</button>
              </span>
            </div>
            {duplicates.map((d, i) => (
              <div key={i} style={{
                padding: '6px 8px', marginBottom: '4px', borderRadius: '4px',
                background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                fontSize: '11px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: Math.round(d.similarity * 100) >= 95 ? '#ef4444' : (isDark ? '#ffaa44' : '#aa6600') }}>
                    {Math.round(d.similarity * 100)}% 유사
                  </span>
                  <span>
                    <button onClick={() => mergeDuplicate(d)} style={{
                      background: 'none', border: 'none', color: isDark ? '#10b981' : '#047857',
                      cursor: 'pointer', fontSize: '9px', marginRight: '4px',
                    }}>병합</button>
                    <button onClick={() => openInObsidian(d.docA.filePath)} style={{
                      background: 'none', border: 'none', color: isDark ? '#88aaff' : '#4466aa',
                      cursor: 'pointer', fontSize: '9px',
                    }}>열기</button>
                  </span>
                </div>
                <div style={{ color: textPrimary, fontSize: '10px', cursor: 'pointer' }}
                  onClick={() => openInObsidian(d.docA.filePath)}>
                  {d.docA.title}
                </div>
                <div style={{ color: textSecondary, fontSize: '10px', cursor: 'pointer' }}
                  onClick={() => openInObsidian(d.docB.filePath)}>
                  ↔ {d.docB.title}
                </div>
              </div>
            ))}
            {duplicates.length === 0 && <div style={{ color: textSecondary, fontSize: '11px' }}>중복 없음!</div>}
          </div>
        )}

        {/* Decay Tab */}
        {tab === 'decay' && !loading && (
          <div>
            <div style={{ fontSize: '10px', color: textSecondary, marginBottom: '8px' }}>
              잊어가는 노트 {decayNotes.length}개
              <button onClick={loadDecay} style={{
                marginLeft: '8px', background: 'none', border: 'none',
                color: isDark ? '#88aaff' : '#4466aa', cursor: 'pointer', fontSize: '10px',
              }}>새로고침</button>
            </div>
            {decayNotes.map((d, i) => {
              const rPct = Math.round(d.retrievability * 100);
              const barW = rPct;
              const barColor = rPct < 30 ? '#ef4444' : rPct < 50 ? '#f59e0b' : '#10b981';
              return (
                <div key={i} style={{
                  padding: '6px 8px', marginBottom: '4px', borderRadius: '4px',
                  background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                  fontSize: '11px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: textPrimary }}>{d.title}</span>
                    <span style={{ color: textSecondary, fontSize: '10px' }}>{d.daysSinceAccess}d</span>
                  </div>
                  <div style={{
                    marginTop: '3px', height: '3px', borderRadius: '2px',
                    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  }}>
                    <div style={{
                      width: `${barW}%`, height: '100%', borderRadius: '2px',
                      background: barColor,
                    }} />
                  </div>
                </div>
              );
            })}
            {decayNotes.length === 0 && <div style={{ color: textSecondary, fontSize: '11px' }}>모든 지식이 건강!</div>}
          </div>
        )}

        {/* Clip Tab */}
        {tab === 'clip' && (
          <div>
            <div style={{ fontSize: '10px', color: textSecondary, marginBottom: '8px' }}>
              URL을 입력하면 Obsidian vault에 저장됩니다
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                value={clipUrl}
                onChange={(e) => setClipUrl(e.target.value)}
                placeholder="https://..."
                style={{
                  flex: 1, padding: '5px 8px', fontSize: '11px',
                  background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  border: `1px solid ${border}`, borderRadius: '4px',
                  color: textPrimary, outline: 'none',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && clipUrl) handleClip();
                }}
              />
              <button
                onClick={handleClip}
                disabled={!clipUrl || loading}
                style={{
                  padding: '5px 10px', fontSize: '10px',
                  background: isDark ? 'rgba(100,120,255,0.15)' : 'rgba(80,100,200,0.08)',
                  border: `1px solid ${btnBorder}`, borderRadius: '4px',
                  color: isDark ? '#88aaff' : '#4466aa', cursor: 'pointer',
                }}
              >Clip</button>
            </div>
            {clipStatus && (
              <div style={{
                marginTop: '6px', fontSize: '10px', padding: '6px 8px',
                borderRadius: '4px',
                background: clipStatus.startsWith('✅')
                  ? (isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.06)')
                  : (isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)'),
                color: clipStatus.startsWith('✅')
                  ? (isDark ? '#10b981' : '#047857')
                  : (isDark ? '#ef4444' : '#dc2626'),
              }}>
                {clipStatus}
              </div>
            )}
          </div>
        )}
        {/* Health Tab */}
        {tab === 'health' && <HealthDashboard />}

        {/* Sync Tab */}
        {tab === 'sync' && (
          <div>
            <div style={{ fontSize: '10px', color: textSecondary, marginBottom: '10px' }}>
              Notion 프로젝트 페이지를 Obsidian vault로 동기화합니다.
              증분 동기화 — 변경된 페이지만 업데이트.
            </div>
            <button
              onClick={handleSync}
              disabled={loading}
              style={{
                width: '100%', padding: '8px', fontSize: '11px',
                background: isDark ? 'rgba(100,120,255,0.12)' : 'rgba(80,100,200,0.08)',
                border: `1px solid ${btnBorder}`, borderRadius: '5px',
                color: isDark ? '#88aaff' : '#4466aa',
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? 'Syncing...' : 'Notion → Obsidian 동기화'}
            </button>
            {syncStatus && (
              <div style={{
                marginTop: '8px', fontSize: '10px', padding: '6px 8px',
                borderRadius: '4px',
                background: syncStatus.startsWith('✅')
                  ? (isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.06)')
                  : (isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)'),
                color: syncStatus.startsWith('✅')
                  ? (isDark ? '#10b981' : '#047857')
                  : (isDark ? '#ef4444' : '#dc2626'),
              }}>
                {syncStatus}
              </div>
            )}
            <div style={{ marginTop: '10px', fontSize: '10px', color: textSecondary }}>
              동기화 후 `stellavault index`로 재인덱싱하면 검색에 반영됩니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );

  async function mergeDuplicate(pair: DuplicatePair) {
    if (!confirm(`"${pair.docB.title}"을 "${pair.docA.title}"에 병합하고 삭제합니다. 계속?`)) return;
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/duplicates/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docAId: pair.docA.id, docBId: pair.docB.id }),
      });
      const data = await res.json();
      if (data.success) {
        setDuplicates(prev => prev.filter(d => d.docA.id !== pair.docA.id || d.docB.id !== pair.docB.id));
      }
    } catch {}
    setLoading(false);
  }

  async function autoCreateBridges() {
    const highGaps = gaps.filter(g => g.severity === 'high');
    if (highGaps.length === 0) { alert('High 심각도 갭이 없습니다'); return; }
    if (!confirm(`${highGaps.length}개 High 갭에 대해 브릿지 노트를 자동 생성합니다. 계속?`)) return;

    setLoading(true);
    let created = 0;
    for (const gap of highGaps) {
      try {
        const res = await fetch('http://127.0.0.1:3333/api/gaps/create-bridge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clusterA: gap.clusterA, clusterB: gap.clusterB }),
        });
        const data = await res.json();
        if (data.success) created++;
      } catch {}
    }
    alert(`${created}/${highGaps.length}개 브릿지 노트 생성 완료`);
    setLoading(false);
    loadGaps(); // 새로고침
  }

  async function openInObsidian(filePath: string) {
    let vault = 'Evan';
    try {
      const res = await fetch('http://127.0.0.1:3333/api/stats');
      const stats = await res.json();
      if (stats.vaultName) vault = stats.vaultName;
    } catch {}
    const relFile = filePath.replace(/\\/g, '/').replace(/\.md$/, '');
    window.location.href = `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(relFile)}`;
  }

  async function createGapNote(gap: GapData) {
    const nameA = gap.clusterA.replace(/\s*\(\d+\)$/, '');
    const nameB = gap.clusterB.replace(/\s*\(\d+\)$/, '');
    const title = `${nameA} × ${nameB}`;
    const content = `# ${title}\n\n> 이 노트는 지식 갭 탐지기에 의해 생성되었습니다.\n> ${nameA}와 ${nameB} 사이의 연결 지식을 정리하세요.\n\n## 관련 주제\n\n- ${nameA}\n- ${nameB}\n\n## 내용\n\n`;

    try {
      const res = await fetch('http://127.0.0.1:3333/api/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `gap://${title}` }),
      });
      // clip API는 URL용이라 직접 파일 생성
    } catch {}

    // Obsidian URI로 새 노트 생성
    let vault = 'Evan';
    try {
      const r = await fetch('http://127.0.0.1:3333/api/stats');
      const s = await r.json();
      if (s.vaultName) vault = s.vaultName;
    } catch {}

    const uri = `obsidian://new?vault=${encodeURIComponent(vault)}&name=${encodeURIComponent(`01_Knowledge/${title}`)}&content=${encodeURIComponent(content)}`;
    window.location.href = uri;
  }

  async function handleSync() {
    setLoading(true);
    setSyncStatus('⏳ 동기화 시작 중...');
    try {
      const res = await fetch('http://127.0.0.1:3333/api/sync', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        setSyncStatus(`❌ ${data.error || 'Failed'}`);
        setLoading(false);
        return;
      }

      setSyncStatus('🔄 동기화 진행 중...');
      // 완료될 때까지 2초마다 상태 확인
      const poll = setInterval(async () => {
        try {
          const sr = await fetch('http://127.0.0.1:3333/api/sync/status');
          const state = await sr.json();
          if (!state.running) {
            clearInterval(poll);
            setLoading(false);
            if (state.result === 'success') {
              setSyncStatus(`✅ 동기화 완료! ${state.output.match(/\d+개 페이지/)?.[0] || ''}`);
            } else {
              setSyncStatus(`❌ 동기화 실패: ${state.output.slice(-100)}`);
            }
          }
        } catch { clearInterval(poll); setLoading(false); }
      }, 2000);
    } catch {
      setSyncStatus('❌ 서버 연결 실패');
      setLoading(false);
    }
  }

  async function handleClip() {
    if (!clipUrl) return;
    setLoading(true);
    setClipStatus('');
    try {
      const res = await fetch('http://127.0.0.1:3333/api/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: clipUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setClipStatus(`✅ ${data.fileName} 저장됨`);
        setClipUrl('');
      } else {
        setClipStatus(`❌ ${data.error || 'Failed'}`);
      }
    } catch {
      setClipStatus('❌ 서버 연결 실패');
    }
    setLoading(false);
  }
}
