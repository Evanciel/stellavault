import { useMemo, useState } from 'react';
import { useGraphStore, type EdgeFilter } from '../stores/graph-store.js';
import { ExportPanel } from './ExportPanel.js';
import { getTheme } from '../lib/theme.js';
import { t, setUiLocale } from '../lib/i18n.js';
import { toggleTagScene, setLocalDepthAndRefresh } from '../lib/scene-actions.js';

export function StatusBar() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const clusters = useGraphStore((s) => s.clusters);
  const loading = useGraphStore((s) => s.loading);
  const buildProgress = useGraphStore((s) => s.buildProgress);
  const mode = useGraphStore((s) => s.mode);
  const lodLevel = useGraphStore((s) => s.lodLevel);
  const themeMode = useGraphStore((s) => s.theme);
  const showHeatmap = useGraphStore((s) => s.showHeatmap);
  const toggleHeatmap = useGraphStore((s) => s.toggleHeatmap);
  const showGaps = useGraphStore((s) => s.showGaps);
  const toggleGaps = useGraphStore((s) => s.toggleGaps);
  const locale = useGraphStore((s) => s.locale);
  const setLocale = useGraphStore((s) => s.setLocale);
  const edgeFilter = useGraphStore((s) => s.edgeFilter);
  const setEdgeFilter = useGraphStore((s) => s.setEdgeFilter);
  const sceneStack = useGraphStore((s) => s.sceneStack);
  const popScene = useGraphStore((s) => s.popScene);
  const resetScene = useGraphStore((s) => s.resetScene);
  const localDepth = useGraphStore((s) => s.localDepth);
  const [tagNote, setTagNote] = useState<string | null>(null);
  const topFrame = sceneStack[sceneStack.length - 1] ?? null;

  const th = getTheme(themeMode);

  // Memoised on [edges]: this bar re-renders on every layout worker tick (it reads `nodes`), and
  // an O(70k) scan per tick for a number that only changes when the edge set does is pure waste.
  // 실볼트 전량에서 2,209개(전체 72,735 중 3.0%)다 — 사용자가 손으로 그은 연결이 그만큼밖에
  // 없다는 사실 자체가 정보라, 추정이 아니라 실제 개수를 센다.
  const linkCount = useMemo(() => edges.reduce((n, e) => n + (e.kind === 'link' ? 1 : 0), 0), [edges]);

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

  // Segmented 3-way edge filter. Each option is a geometry.setDrawRange in GraphEdges — the buffer
  // is partitioned link-edges-first, so flipping this costs two numbers, not a rebuild.
  const edgeOptions: Array<{ value: EdgeFilter; label: string; title: string }> = [
    { value: 'both', label: t('btn.edges.both'), title: t('btn.edges.hint') },
    { value: 'links', label: t('btn.edges.links'), title: `${linkCount} ${t('btn.edges.linkCount')}` },
    { value: 'semantic', label: t('btn.edges.semantic'), title: t('btn.edges.hint') },
  ];

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
        <span>
          {buildProgress
            // 전량 스케일 콜드 빌드는 실측 27초다. 단계와 진행 노트 수를 보여주지 않으면
            // 사용자가 멈춘 것으로 읽는다.
            ? `${t(`status.phase.${buildProgress.phase}`)}${buildProgress.total > 0 ? ` ${buildProgress.done.toLocaleString()} / ${buildProgress.total.toLocaleString()}` : ''}`
            : t('status.loading')}
        </span>
      ) : (
        <>
          <span>{nodes.length} {t('status.docs')}</span>
          <span>{edges.length} {t('status.edges')}</span>
          {sceneStack.length === 0 ? (
            <span>{clusters.length} {t('status.clusters')}</span>
          ) : (
            // 빵부스러기. 드릴인이 클러스터 한 겹이던 시절에는 "탐색 중: X" 한 줄로 충분했지만,
            // 이제 폴더가 여러 겹 쌓이고 로컬 그래프까지 섞여서 어디까지 파고들었는지 경로가 필요하다.
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '46%', overflow: 'hidden' }}>
              <button onClick={resetScene} style={{ ...toggleBtnStyle(false), padding: '1px 5px' }}>
                {t('scene.all')}
              </button>
              {sceneStack.map((f, i) => (
                <span key={`${f.kind}:${f.key}:${i}`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ color: th.textDim }}>/</span>
                  <span style={{
                    color: i === sceneStack.length - 1 ? th.textAccent : th.textMuted,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px',
                  }}>
                    {f.kind === 'local' ? `◎ ${f.label}` : f.label}
                  </span>
                </span>
              ))}
              <button onClick={popScene} style={{ ...toggleBtnStyle(false), padding: '1px 5px', marginLeft: '2px' }}>
                {t('scene.back')}
              </button>
              {topFrame?.kind === 'local' && (
                // 로컬 그래프에서만 홉 조절이 의미가 있다. 1~3 이상은 실볼트에서 곧바로
                // 전체 그래프에 수렴해서(엣지 밀도가 높다) 버튼으로 둘 이유가 없다.
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px', marginLeft: '4px' }}>
                  {[1, 2, 3].map((d) => (
                    <button
                      key={d}
                      onClick={() => setLocalDepthAndRefresh(d)}
                      title={`${d} ${t('scene.hops')}`}
                      style={{ ...toggleBtnStyle(localDepth === d), padding: '1px 5px' }}
                    >
                      {d}
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
          <span style={{ color: th.textDim }}>|</span>
          <span style={{ color: mode === 'semantic' ? th.textAccent : th.success }}>
            {mode === 'semantic' ? t('btn.semantic') : t('btn.folders')}
          </span>
          <span style={{ color: th.textDim }}>|</span>
          <span style={{ color: lodLevel === 'universe' ? '#c088ff' : lodLevel === 'note' ? '#88ffaa' : th.textAccent }}>
            {lodLevel}
          </span>
          {/* Galaxy only — while drilled in, the full label roll-call describes clusters that are
              not on screen (the breadcrumb above already names where we are). 폴더·로컬 프레임도
              갤럭시를 떠난 상태라 focusedClusterId 가 아니라 스택 깊이로 판정한다. */}
          {sceneStack.length === 0 && (
            <span style={{ color: th.textDim, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {clusters.map(c => c.label).join(' · ')}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ color: th.textDim }}>{t('btn.edges')}</span>
            <div style={{ display: 'flex', gap: '2px' }}>
              {edgeOptions.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setEdgeFilter(o.value)}
                  title={o.title}
                  style={toggleBtnStyle(edgeFilter === o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                const r = toggleTagScene();
                // 이 볼트는 태그가 사실상 없다(17,339개 중 26개). 아무 일도 안 일어나면
                // 고장처럼 보이므로 왜 비었는지 말해준다.
                setTagNote(r.on || r.tagCount > 0 ? null : t('scene.tagsEmpty'));
                if (!r.on && r.tagCount === 0) setTimeout(() => setTagNote(null), 4000);
              }}
              title={t('scene.tags')}
              style={toggleBtnStyle(topFrame?.kind === 'tag')}
            >
              {t('scene.tags')}
            </button>
            {tagNote && <span style={{ color: th.textMuted, fontSize: '10px' }}>{tagNote}</span>}
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
