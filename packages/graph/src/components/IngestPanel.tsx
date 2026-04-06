// 웹 UI 인제스트 패널 — URL/텍스트/아이디어를 바로 입력
import { useState, useCallback } from 'react';
import { useGraphStore } from '../stores/graph-store.js';
import { getTheme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export function IngestPanel() {
  const themeMode = useGraphStore((s) => s.theme);
  const th = getTheme(themeMode);

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [tags, setTags] = useState('');
  const [stage, setStage] = useState<'fleeting' | 'literature'>('fleeting');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [result, setResult] = useState('');
  const [recentItems, setRecentItems] = useState<any[]>([]);

  const handleSubmit = useCallback(async () => {
    if (!input.trim()) return;
    setStatus('sending');

    try {
      const resp = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: input.trim(),
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
          stage,
        }),
      });

      const data = await resp.json();
      if (data.success) {
        setStatus('success');
        setResult(`${data.title}`);
        setInput('');
        setTags('');
        setRecentItems(prev => [{ title: data.title, savedTo: data.savedTo, stage: data.stage, tags: data.tags }, ...prev].slice(0, 5));
        // 그래프 자동 새로고침 — 새 노드 반영
        try {
          const graphResp = await fetch('/api/graph?mode=semantic');
          const graphData = await graphResp.json();
          if (graphData.nodes) {
            const store = useGraphStore.getState();
            store.setGraphData(graphData.nodes, graphData.edges, graphData.clusters);
          }
        } catch { /* 그래프 새로고침 실패해도 무시 */ }
        setTimeout(() => { setStatus('idle'); setResult(''); }, 4000);
      } else {
        setStatus('error');
        setResult(data.error || 'Failed');
      }
    } catch {
      setStatus('error');
      setResult('Server not responding');
    }
  }, [input, tags, stage]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Add knowledge (URL, text, idea)"
        style={{
          position: 'fixed',
          bottom: '60px',
          right: '16px',
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          border: `2px solid ${th.borderActive}`,
          background: th.bgSolid,
          color: th.textAccent,
          fontSize: '22px',
          cursor: 'pointer',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.transform = 'scale(1.1)'; }}
        onMouseLeave={(e) => { (e.target as HTMLElement).style.transform = 'scale(1)'; }}
      >
        +
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '60px',
      right: '16px',
      width: '360px',
      background: th.bgSolid,
      border: `1px solid ${th.border}`,
      borderRadius: '12px',
      padding: '16px',
      zIndex: 100,
      boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      transition: 'all 0.2s ease',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ color: th.text, fontWeight: 600, fontSize: '13px' }}>
          {t('ingest.title')}
        </span>
        <button
          onClick={() => setOpen(false)}
          style={{ background: 'none', border: 'none', color: th.textMuted, cursor: 'pointer', fontSize: '16px' }}
        >
          x
        </button>
      </div>

      {/* Input */}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={t('ingest.placeholder')}
        style={{
          width: '100%',
          height: '80px',
          background: th.accent,
          border: `1px solid ${th.buttonBorder}`,
          borderRadius: '8px',
          padding: '10px',
          color: th.text,
          fontSize: '13px',
          resize: 'vertical',
          outline: 'none',
          fontFamily: 'inherit',
        }}
      />

      {/* Options */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder={t('ingest.tags')}
          style={{
            flex: 1,
            padding: '6px 10px',
            background: th.accent,
            border: `1px solid ${th.buttonBorder}`,
            borderRadius: '6px',
            color: th.text,
            fontSize: '11px',
            outline: 'none',
          }}
        />
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value as 'fleeting' | 'literature')}
          style={{
            padding: '6px 8px',
            background: th.accent,
            border: `1px solid ${th.buttonBorder}`,
            borderRadius: '6px',
            color: th.text,
            fontSize: '11px',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="fleeting">Fleeting</option>
          <option value="literature">Literature</option>
        </select>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={status === 'sending' || !input.trim()}
        style={{
          width: '100%',
          marginTop: '10px',
          padding: '8px',
          background: status === 'success' ? th.success : th.buttonActive,
          border: `1px solid ${th.borderActive}`,
          borderRadius: '8px',
          color: th.text,
          fontSize: '12px',
          fontWeight: 600,
          cursor: status === 'sending' ? 'wait' : 'pointer',
          transition: 'all 0.15s ease',
        }}
      >
        {status === 'sending' ? t('ingest.saving') :
         status === 'success' ? t('ingest.saved') :
         status === 'error' ? t('ingest.error') :
         t('ingest.add')}
      </button>

      {/* Result */}
      {result && (
        <div style={{
          marginTop: '8px',
          fontSize: '11px',
          color: status === 'success' ? th.success : th.danger,
          wordBreak: 'break-all',
        }}>
          {result}
        </div>
      )}

      {/* Recent saves */}
      {recentItems.length > 0 && (
        <div style={{ marginTop: '10px', borderTop: `1px solid ${th.border}`, paddingTop: '8px' }}>
          <div style={{ fontSize: '10px', color: th.textDim, marginBottom: '4px' }}>최근 저장</div>
          {recentItems.map((item, i) => (
            <div key={i} style={{
              fontSize: '11px', color: th.textMuted, padding: '5px 6px',
              borderBottom: `1px solid ${th.border}`,
              cursor: 'pointer',
              borderRadius: '4px',
              transition: 'background 0.1s',
            }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = th.accent; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              onClick={async () => {
                // 1차: 그래프 노드에서 찾기
                const store = useGraphStore.getState();
                const titleShort = item.title.slice(0, 20);
                const savedNorm = item.savedTo.replace(/\\/g, '/');
                const node = store.nodes.find(n =>
                  n.label === item.title ||
                  n.filePath?.replace(/\\/g, '/') === savedNorm ||
                  n.label.includes(titleShort)
                );
                if (node) {
                  store.selectNode(node.id);
                  store.setHighlightedNodes([node.id]);
                  setOpen(false);
                  return;
                }

                // 2차: 검색으로 찾아서 하이라이트
                try {
                  const resp = await fetch(`/api/search?q=${encodeURIComponent(item.title)}&limit=1`);
                  const data = await resp.json();
                  if (data.results?.[0]) {
                    const docId = data.results[0].documentId;
                    const found = store.nodes.find(n => n.id === docId);
                    if (found) {
                      store.selectNode(found.id);
                      store.setHighlightedNodes([found.id]);
                      setOpen(false);
                      return;
                    }
                  }
                } catch { /* ignore */ }

                // 못 찾으면 안내
                setResult(`"${item.title}" — 아직 인덱싱 전입니다. stellavault index를 실행하면 노드에 나타나요.`);
                setStatus('error');
                setTimeout(() => { setStatus('idle'); setResult(''); }, 5000);
              }}
            >
              <span style={{ color: th.text }}>{item.title}</span>
              <span style={{ color: th.textDim, marginLeft: '6px', fontSize: '10px' }}>→ 노드로 이동</span>
            </div>
          ))}
        </div>
      )}

      {/* Hints */}
      <div style={{ marginTop: '8px', fontSize: '10px', color: th.textDim, lineHeight: 1.5 }}>
        {t('ingest.hint')}
      </div>
    </div>
  );
}
