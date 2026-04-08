// 그래프 컨텍스트 메뉴 — 우클릭으로 노드 추가/연결/삭제

import { useState, useEffect, useCallback } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

interface MenuPos { x: number; y: number }

export function ContextMenu() {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [connecting, setConnecting] = useState(false);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId);
  const nodes = useGraphStore((s) => s.nodes);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';

  // 우클릭 핸들러
  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      const canvas = document.querySelector('canvas');
      if (!canvas?.contains(e.target as Node)) return;
      e.preventDefault();
      setPos({ x: e.clientX, y: e.clientY });
      setShowAddForm(false);
    }
    function onClickAway() { setPos(null); setConnecting(false); }
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('click', onClickAway);
    return () => {
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('click', onClickAway);
    };
  }, []);

  // 연결 모드: 다른 노드 클릭하면 연결
  useEffect(() => {
    if (!connecting || !selectedNodeId) return;
    if (hoveredNodeId && hoveredNodeId !== selectedNodeId) {
      // 클릭 감지 (mouseup)
      function onUp() {
        const store = useGraphStore.getState();
        if (store.hoveredNodeId && store.hoveredNodeId !== selectedNodeId) {
          handleConnect(selectedNodeId!, store.hoveredNodeId);
          setConnecting(false);
        }
      }
      window.addEventListener('mouseup', onUp, { once: true });
      return () => window.removeEventListener('mouseup', onUp);
    }
  }, [connecting, hoveredNodeId, selectedNodeId]);

  const handleAdd = useCallback(async () => {
    if (!newTitle.trim()) return;
    try {
      const resp = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: newTitle.trim(), tags: [] }),
      });
      const data = await resp.json();
      if (data.success) {
        // 그래프 새로고침
        const graphResp = await fetch('/api/graph?mode=semantic');
        const graphData = await graphResp.json();
        if (graphData.data?.nodes) {
          useGraphStore.getState().setGraphData(graphData.data.nodes, graphData.data.edges, graphData.data.clusters);
        } else if (graphData.nodes) {
          useGraphStore.getState().setGraphData(graphData.nodes, graphData.edges, graphData.clusters);
        }
        setNewTitle('');
        setShowAddForm(false);
        setPos(null);
      }
    } catch (err) { console.error(err); alert('Operation failed. Please try again.'); }
  }, [newTitle]);

  const handleConnect = useCallback(async (fromId: string, toId: string) => {
    const fromNode = nodes.find(n => n.id === fromId);
    const toNode = nodes.find(n => n.id === toId);
    if (!fromNode || !toNode) return;

    // 원본 문서에 [[wikilink]] 추가
    try {
      const resp = await fetch(`/api/document/${fromId}`);
      const doc = await resp.json();
      if (doc.content) {
        const linkText = `\n\n[[${toNode.label}]]\n`;
        await fetch(`/api/document/${fromId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: doc.title,
            content: doc.content + linkText,
            tags: doc.tags,
          }),
        });
        // 그래프 새로고침
        const graphResp = await fetch('/api/graph/refresh?mode=semantic');
        const graphData = await graphResp.json();
        if (graphData.data?.nodes) {
          useGraphStore.getState().setGraphData(graphData.data.nodes, graphData.data.edges, graphData.data.clusters);
        }
      }
    } catch (err) { console.error(err); alert('Operation failed. Please try again.'); }
    setPos(null);
  }, [nodes]);

  const handleDelete = useCallback(async () => {
    if (!selectedNodeId) return;
    const node = nodes.find(n => n.id === selectedNodeId);
    if (!node || !confirm(`Delete "${node.label}"?`)) return;
    try {
      await fetch(`/api/document/${selectedNodeId}`, { method: 'DELETE' });
      useGraphStore.getState().selectNode(null);
      const graphResp = await fetch('/api/graph/refresh?mode=semantic');
      const graphData = await graphResp.json();
      if (graphData.data?.nodes) {
        useGraphStore.getState().setGraphData(graphData.data.nodes, graphData.data.edges, graphData.data.clusters);
      }
    } catch (err) { console.error(err); alert('Operation failed. Please try again.'); }
    setPos(null);
  }, [selectedNodeId, nodes]);

  if (!pos) return null;

  const menuBg = isDark ? 'rgba(12,12,20,0.97)' : 'rgba(255,255,255,0.98)';
  const menuBorder = isDark ? 'rgba(100,120,255,0.2)' : 'rgba(0,0,0,0.1)';
  const itemHover = isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.04)';
  const textColor = isDark ? '#dde' : '#333';
  const dimColor = isDark ? '#778' : '#999';

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, zIndex: 300,
      background: menuBg, border: `1px solid ${menuBorder}`,
      borderRadius: '10px', padding: '4px', minWidth: '180px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      backdropFilter: 'blur(12px)',
    }} onClick={(e) => e.stopPropagation()}>

      {connecting ? (
        <div style={{ padding: '10px 14px', fontSize: '12px', color: isDark ? '#818cf8' : '#6366f1', textAlign: 'center' }}>
          Click another node to connect...
          <button onClick={() => setConnecting(false)} style={{
            display: 'block', margin: '6px auto 0', padding: '3px 12px',
            background: 'transparent', border: `1px solid ${menuBorder}`,
            borderRadius: '4px', color: dimColor, fontSize: '11px', cursor: 'pointer',
          }}>Cancel</button>
        </div>
      ) : showAddForm ? (
        <div style={{ padding: '8px 10px' }}>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setShowAddForm(false); setPos(null); } }}
            placeholder="New note title..."
            autoFocus
            style={{
              width: '100%', padding: '6px 8px', background: 'transparent',
              border: `1px solid ${menuBorder}`, borderRadius: '6px',
              color: textColor, fontSize: '12px', outline: 'none', marginBottom: '6px',
            }}
          />
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={handleAdd} style={{
              flex: 1, padding: '5px', background: isDark ? '#6366f1' : '#e0e7ff',
              border: 'none', borderRadius: '5px', color: isDark ? '#fff' : '#6366f1',
              fontSize: '11px', cursor: 'pointer', fontWeight: 600,
            }}>Create</button>
            <button onClick={() => { setShowAddForm(false); setPos(null); }} style={{
              padding: '5px 10px', background: 'transparent', border: `1px solid ${menuBorder}`,
              borderRadius: '5px', color: dimColor, fontSize: '11px', cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <MenuItem label="+ New Note" shortcut="N" color={textColor} hoverBg={itemHover} onClick={() => setShowAddForm(true)} />
          {selectedNodeId && (
            <>
              <MenuItem label="Connect to..." shortcut="C" color={textColor} hoverBg={itemHover} onClick={() => { setConnecting(true); setPos(null); }} />
              <div style={{ height: '1px', background: menuBorder, margin: '2px 4px' }} />
              <MenuItem label="Delete" shortcut="Del" color={isDark ? '#f87171' : '#dc2626'} hoverBg={isDark ? 'rgba(248,113,113,0.1)' : 'rgba(220,38,38,0.05)'} onClick={handleDelete} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function MenuItem({ label, shortcut, color, hoverBg, onClick }: { label: string; shortcut: string; color: string; hoverBg: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
        padding: '7px 12px', background: 'transparent', border: 'none',
        borderRadius: '6px', cursor: 'pointer', color, fontSize: '12px', textAlign: 'left',
      }}
      onMouseEnter={(e) => { (e.currentTarget).style.background = hoverBg; }}
      onMouseLeave={(e) => { (e.currentTarget).style.background = 'transparent'; }}
    >
      <span>{label}</span>
      <span style={{ fontSize: '10px', opacity: 0.4 }}>{shortcut}</span>
    </button>
  );
}
