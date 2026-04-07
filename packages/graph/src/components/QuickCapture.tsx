// Quick Capture — 키보드 N 또는 화면 터치로 즉시 메모
// 3초 안에 아이디어 캡처 → fleeting 직행

import { useState, useEffect, useRef, useCallback } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';

  // N 키 또는 커스텀 이벤트로 열기
  useEffect(() => {
    function onQuickCapture() { setOpen(true); setTimeout(() => inputRef.current?.focus(), 100); }
    window.addEventListener('sv-quick-capture', onQuickCapture);
    return () => window.removeEventListener('sv-quick-capture', onQuickCapture);
  }, []);

  const handleSave = useCallback(async () => {
    if (!text.trim()) return;
    setStatus('saving');
    try {
      const resp = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text.trim(),
          tags: ['fleeting', 'quick-capture'],
          stage: 'fleeting',
          locale: useGraphStore.getState().locale,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setStatus('saved');
        setTimeout(() => { setOpen(false); setText(''); setStatus('idle'); }, 800);
        // 그래프 새로고침
        try {
          const graphResp = await fetch('/api/graph?mode=semantic');
          const graphData = await graphResp.json();
          if (graphData.nodes) {
            useGraphStore.getState().setGraphData(graphData.nodes, graphData.edges, graphData.clusters);
          }
        } catch { /* ok */ }
      }
    } catch {
      setStatus('idle');
    }
  }, [text]);

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={() => { setOpen(false); setText(''); }}>
      <div style={{
        width: '90%', maxWidth: '500px',
        background: isDark ? '#0c0c14' : '#fff',
        border: `1px solid ${isDark ? '#252535' : '#e0e0e0'}`,
        borderRadius: '16px', padding: '20px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: '11px', color: isDark ? '#667' : '#999', marginBottom: '10px', letterSpacing: '1px', textTransform: 'uppercase' }}>
          Quick Capture
        </div>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave();
            if (e.key === 'Escape') { setOpen(false); setText(''); }
          }}
          placeholder="Type your thought... (Ctrl+Enter to save)"
          style={{
            width: '100%', height: '120px', padding: '12px',
            background: isDark ? 'rgba(100,120,255,0.05)' : 'rgba(0,0,0,0.02)',
            border: `1px solid ${isDark ? '#252535' : '#e0e0e0'}`,
            borderRadius: '10px', resize: 'none', outline: 'none',
            color: isDark ? '#e0e0f0' : '#333',
            fontSize: '15px', lineHeight: 1.6, fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
          <span style={{ fontSize: '11px', color: isDark ? '#556' : '#bbb' }}>
            Ctrl+Enter to save | Esc to close
          </span>
          <button
            onClick={handleSave}
            disabled={!text.trim() || status === 'saving'}
            style={{
              padding: '8px 24px',
              background: status === 'saved' ? (isDark ? '#10b981' : '#059669') : (isDark ? '#6366f1' : '#6366f1'),
              border: 'none', borderRadius: '8px',
              color: '#fff', fontSize: '13px', fontWeight: 600,
              cursor: text.trim() ? 'pointer' : 'default',
              opacity: text.trim() ? 1 : 0.4,
              transition: 'all 0.2s',
            }}
          >
            {status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved!' : 'Capture'}
          </button>
        </div>
      </div>
    </div>
  );
}
