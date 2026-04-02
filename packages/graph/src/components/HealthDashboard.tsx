// 노트 건강도 대시보드 — decay/gaps/duplicates/growth 종합 뷰

import { useState, useEffect } from 'react';
import { fetchHealth } from '../api/client.js';
import { useGraphStore } from '../stores/graph-store.js';

interface HealthData {
  stats: { documentCount: number; chunkCount: number; dbSizeMB?: number; vaultName?: string };
  decay: { totalDocuments: number; criticalCount: number; decayingCount: number; averageR: number; topDecaying: Array<{ title: string; retrievability: number }> };
  gaps: { gapCount: number; isolatedCount: number };
  duplicates: { count: number };
  distribution: { source: Record<string, number>; type: Record<string, number> };
  growth: Record<string, number>;
}

function MetricCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';
  return (
    <div style={{
      padding: '10px 12px', borderRadius: '8px', flex: '1 1 120px', minWidth: '120px',
      background: isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.02)',
      border: `1px solid ${isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.06)'}`,
    }}>
      <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: isDark ? '#667' : '#999', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, color, lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '10px', color: isDark ? '#556' : '#888', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

function MiniBar({ items, isDark }: { items: Array<{ label: string; value: number; color: string }>; isDark: boolean }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
          <span style={{ width: '50px', color: isDark ? '#aab' : '#555', textAlign: 'right' }}>{item.label}</span>
          <div style={{ flex: 1, height: '6px', background: isDark ? 'rgba(100,120,255,0.08)' : 'rgba(0,0,0,0.04)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${(item.value / total) * 100}%`, height: '100%', background: item.color, borderRadius: '3px' }} />
          </div>
          <span style={{ width: '30px', color: isDark ? '#667' : '#999', fontSize: '9px' }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

const SOURCE_COLORS: Record<string, string> = {
  local: '#10b981', notion: '#3b82f6', clip: '#f59e0b', bridge: '#8b5cf6', pack: '#ec4899',
};

const TYPE_COLORS: Record<string, string> = {
  note: '#3b82f6', clip: '#f59e0b', sync: '#10b981', bridge: '#8b5cf6', decision: '#ef4444', snapshot: '#06b6d4',
};

export function HealthDashboard() {
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchHealth()
      .then(setData)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: '20px', color: isDark ? '#667' : '#999', fontSize: '12px' }}>Loading health data...</div>;
  if (error) return <div style={{ padding: '20px', color: '#ef4444', fontSize: '12px' }}>{error}</div>;
  if (!data) return null;

  const rPct = Math.round(data.decay.averageR * 100);
  const rColor = rPct >= 70 ? '#10b981' : rPct >= 40 ? '#f59e0b' : '#ef4444';

  const sourceItems = Object.entries(data.distribution.source).map(([label, value]) => ({
    label, value, color: SOURCE_COLORS[label] ?? '#666',
  }));
  const typeItems = Object.entries(data.distribution.type).map(([label, value]) => ({
    label, value, color: TYPE_COLORS[label] ?? '#666',
  }));

  // 성장 추이 — 최근 12개월 미니 차트
  const growthEntries = Object.entries(data.growth).slice(-12);
  const maxGrowth = Math.max(1, ...growthEntries.map(([, v]) => v));

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 핵심 메트릭 */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <MetricCard label="Total Docs" value={data.stats.documentCount} sub={`${data.stats.chunkCount} chunks`} color={isDark ? '#c0c0f0' : '#2a2a4a'} />
        <MetricCard label="Avg Retrievability" value={`${rPct}%`} sub={`${data.decay.criticalCount} critical`} color={rColor} />
        <MetricCard label="Knowledge Gaps" value={data.gaps.gapCount} sub={`${data.gaps.isolatedCount} isolated`} color={data.gaps.gapCount > 5 ? '#f59e0b' : '#10b981'} />
        <MetricCard label="Duplicates" value={data.duplicates.count} color={data.duplicates.count > 10 ? '#f59e0b' : '#10b981'} />
      </div>

      {/* 분포 */}
      <div style={{ display: 'flex', gap: '16px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: isDark ? '#667' : '#999', marginBottom: '6px' }}>
            By Source
          </div>
          <MiniBar items={sourceItems} isDark={isDark} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: isDark ? '#667' : '#999', marginBottom: '6px' }}>
            By Type
          </div>
          <MiniBar items={typeItems} isDark={isDark} />
        </div>
      </div>

      {/* 성장 추이 */}
      {growthEntries.length > 1 && (
        <div>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: isDark ? '#667' : '#999', marginBottom: '6px' }}>
            Monthly Growth
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '40px' }}>
            {growthEntries.map(([month, count]) => (
              <div key={month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                <div style={{
                  width: '100%', maxWidth: '24px',
                  height: `${(count / maxGrowth) * 100}%`, minHeight: '2px',
                  background: isDark ? 'rgba(100,180,255,0.5)' : 'rgba(59,130,246,0.4)',
                  borderRadius: '2px 2px 0 0',
                }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '2px', marginTop: '2px' }}>
            {growthEntries.map(([month]) => (
              <div key={month} style={{ flex: 1, fontSize: '7px', color: isDark ? '#445' : '#bbb', textAlign: 'center', overflow: 'hidden' }}>
                {month.slice(5)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decay 위험 노트 */}
      {data.decay.topDecaying.length > 0 && (
        <div>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: isDark ? '#667' : '#999', marginBottom: '4px' }}>
            Most Decaying Notes
          </div>
          {data.decay.topDecaying.map((d, i) => {
            const r = Math.round((d.retrievability ?? 0) * 100);
            const barColor = r >= 50 ? '#10b981' : r >= 30 ? '#f59e0b' : '#ef4444';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0', fontSize: '10px' }}>
                <span style={{ flex: 1, color: isDark ? '#aab' : '#444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.title}
                </span>
                <div style={{ width: '60px', height: '4px', background: isDark ? 'rgba(100,120,255,0.08)' : 'rgba(0,0,0,0.04)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${r}%`, height: '100%', background: barColor, borderRadius: '2px' }} />
                </div>
                <span style={{ width: '28px', color: barColor, fontSize: '9px', textAlign: 'right' }}>{r}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
