// 사이드패널: 클릭된 노드의 문서 미리보기

import { useEffect, useState, useRef, useMemo } from 'react';
import Markdown from 'react-markdown';
import { fetchDocument } from '../api/client.js';
import { useGraphStore } from '../stores/graph-store.js';

interface DocData {
  id: string;
  title: string;
  filePath: string;
  content: string;
  tags: string[];
  lastModified: string;
  related: Array<{ id: string; title: string; score: number }>;
}

export function NodeDetail() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';
  const [doc, setDoc] = useState<DocData | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Map<string, DocData>>(new Map());
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [saveStatus, setSaveStatus] = useState<'' | 'saving' | 'saved' | 'error'>('');

  useEffect(() => {
    if (!selectedNodeId) { setDoc(null); return; }

    const cached = cacheRef.current.get(selectedNodeId);
    if (cached) { setDoc(cached); return; }

    let cancelled = false;
    setLoading(true);
    fetchDocument(selectedNodeId)
      .then((data: any) => {
        if (!cancelled) { setDoc(data); cacheRef.current.set(selectedNodeId, data); }
      })
      .catch(() => { if (!cancelled) setDoc(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedNodeId]);

  if (!selectedNodeId) return null;

  // Theme colors
  const bg = isDark ? '#0d0d18' : '#fafafa';
  const border = isDark ? 'rgba(100, 120, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)';
  const textPrimary = isDark ? '#e0e0f0' : '#1a1a2e';
  const textSecondary = isDark ? '#556' : '#888';
  const textBody = isDark ? '#b0b0c0' : '#444';
  const tagBg = isDark ? 'rgba(100, 120, 255, 0.1)' : 'rgba(80, 100, 200, 0.08)';
  const tagColor = isDark ? '#88aaff' : '#4466aa';
  const btnBg = isDark ? 'rgba(100, 120, 255, 0.1)' : 'rgba(80, 100, 200, 0.06)';
  const btnBorder = isDark ? 'rgba(100, 120, 255, 0.2)' : 'rgba(80, 100, 200, 0.15)';
  const btnColor = isDark ? '#88aaff' : '#4466aa';

  return (
    <div style={{
      width: '380px', background: bg,
      borderLeft: `1px solid ${border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: `1px solid ${border}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: '11px', color: textSecondary, textTransform: 'uppercase', letterSpacing: '1px' }}>
          Document Preview
        </span>
        <button
          onClick={() => selectNode(null)}
          style={{ background: 'none', border: 'none', color: textSecondary, cursor: 'pointer', fontSize: '14px', padding: '2px 6px' }}
        >
          x
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '24px 16px', color: textSecondary }}>Loading...</div>
      ) : doc ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: textPrimary, marginBottom: '6px', lineHeight: 1.3 }}>
            {doc.title}
          </h2>
          {doc.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '10px' }}>
              {doc.tags.map((tag) => (
                <span key={tag} style={{ fontSize: '10px', color: tagColor, background: tagBg, padding: '1px 7px', borderRadius: '4px' }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <div style={{ fontSize: '10px', color: textSecondary, marginBottom: '12px' }}>
            {new Date(doc.lastModified).toLocaleDateString('ko-KR')}
          </div>
          <button
            onClick={() => {
              setTimeout(() => (window as any).__sv_pulse?.(doc.id), 100);
            }}
            style={{
              width: '100%', padding: '7px', marginBottom: '8px',
              background: btnBg, border: `1px solid ${btnBorder}`,
              borderRadius: '5px', color: btnColor, fontSize: '11px', cursor: 'pointer',
            }}
          >
            Explore connections
          </button>
          <button
            onClick={async () => {
              const relFile = (doc.filePath ?? doc.title).replace(/\\/g, '/').replace(/\.md$/, '');
              let vault = 'Evan';
              try {
                const res = await fetch('http://127.0.0.1:3333/api/stats');
                const stats = await res.json();
                if (stats.vaultName) vault = stats.vaultName;
              } catch { /* fallback */ }
              const uri = `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(relFile)}`;
              window.location.href = uri;
            }}
            style={{
              width: '100%', padding: '7px', marginBottom: '14px',
              background: isDark ? 'rgba(140, 100, 255, 0.08)' : 'rgba(120, 80, 200, 0.05)',
              border: `1px solid ${isDark ? 'rgba(140, 100, 255, 0.15)' : 'rgba(120, 80, 200, 0.12)'}`,
              borderRadius: '5px', color: isDark ? '#a088ff' : '#6644aa', fontSize: '11px', cursor: 'pointer',
            }}
          >
            Open in Obsidian
          </button>

          {/* 편집/삭제 버튼 */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
            <button
              onClick={() => {
                if (editing) {
                  setEditing(false);
                } else {
                  setEditTitle(doc.title);
                  setEditContent(doc.content);
                  setEditTags(doc.tags.join(', '));
                  setEditing(true);
                }
              }}
              style={{
                flex: 1, padding: '7px', background: editing ? btnBg : 'transparent',
                border: `1px solid ${btnBorder}`, borderRadius: '5px',
                color: btnColor, fontSize: '11px', cursor: 'pointer',
              }}
            >
              {editing ? '편집 취소' : '편집'}
            </button>
            <button
              onClick={async () => {
                if (!confirm(`"${doc.title}" 노트를 삭제하시겠습니까?\nObsidian vault에서도 삭제됩니다.`)) return;
                try {
                  const resp = await fetch(`/api/document/${doc.id}`, { method: 'DELETE' });
                  const data = await resp.json();
                  if (data.success) {
                    cacheRef.current.delete(doc.id);
                    selectNode(null);
                    // 그래프 새로고침
                    const graphResp = await fetch('/api/graph/refresh?mode=semantic');
                    const graphData = await graphResp.json();
                    if (graphData.data?.nodes) {
                      useGraphStore.getState().setGraphData(graphData.data.nodes, graphData.data.edges, graphData.data.clusters);
                    }
                  }
                } catch { /* ignore */ }
              }}
              style={{
                padding: '7px 12px', background: 'transparent',
                border: `1px solid ${isDark ? 'rgba(255,80,80,0.2)' : 'rgba(200,50,50,0.15)'}`,
                borderRadius: '5px', color: isDark ? '#ff6666' : '#cc3333',
                fontSize: '11px', cursor: 'pointer',
              }}
            >
              삭제
            </button>
          </div>

          {/* 편집 모드 */}
          {editing ? (
            <div style={{ marginBottom: '14px' }}>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="제목"
                style={{
                  width: '100%', padding: '6px 8px', marginBottom: '6px',
                  background: isDark ? 'rgba(100,120,255,0.08)' : 'rgba(0,0,0,0.03)',
                  border: `1px solid ${border}`, borderRadius: '5px',
                  color: textPrimary, fontSize: '13px', fontWeight: 600, outline: 'none',
                }}
              />
              <input
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="태그 (쉼표 구분)"
                style={{
                  width: '100%', padding: '5px 8px', marginBottom: '6px',
                  background: isDark ? 'rgba(100,120,255,0.08)' : 'rgba(0,0,0,0.03)',
                  border: `1px solid ${border}`, borderRadius: '5px',
                  color: tagColor, fontSize: '11px', outline: 'none',
                }}
              />
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                style={{
                  width: '100%', height: '200px', padding: '8px',
                  background: isDark ? 'rgba(100,120,255,0.05)' : 'rgba(0,0,0,0.02)',
                  border: `1px solid ${border}`, borderRadius: '5px',
                  color: textPrimary, fontSize: '12px', lineHeight: 1.6,
                  resize: 'vertical', outline: 'none', fontFamily: 'monospace',
                }}
              />
              <button
                onClick={async () => {
                  setSaveStatus('saving');
                  try {
                    const resp = await fetch(`/api/document/${doc.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        title: editTitle,
                        content: editContent,
                        tags: editTags.split(',').map(t => t.trim()).filter(Boolean),
                      }),
                    });
                    const data = await resp.json();
                    if (data.success) {
                      setSaveStatus('saved');
                      // 캐시 업데이트
                      const updated = { ...doc, title: editTitle, content: editContent, tags: editTags.split(',').map(t => t.trim()).filter(Boolean) };
                      setDoc(updated);
                      cacheRef.current.set(doc.id, updated);
                      setTimeout(() => { setEditing(false); setSaveStatus(''); }, 1000);
                    } else {
                      setSaveStatus('error');
                    }
                  } catch {
                    setSaveStatus('error');
                  }
                }}
                disabled={saveStatus === 'saving'}
                style={{
                  width: '100%', padding: '8px', marginTop: '6px',
                  background: saveStatus === 'saved' ? (isDark ? 'rgba(16,185,129,0.2)' : 'rgba(5,150,105,0.1)') : btnBg,
                  border: `1px solid ${btnBorder}`, borderRadius: '5px',
                  color: saveStatus === 'saved' ? (isDark ? '#10b981' : '#059669') : btnColor,
                  fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                {saveStatus === 'saving' ? '저장 중...' : saveStatus === 'saved' ? '저장 완료!' : saveStatus === 'error' ? '오류 — 재시도' : '저장 (Obsidian에도 반영)'}
              </button>
            </div>
          ) : (
            <ContentAccordion content={doc.content} isDark={isDark} />
          )}
          {doc.related.length > 0 && (
            <div style={{ marginTop: '20px', paddingTop: '12px', borderTop: `1px solid ${border}` }}>
              <div style={{ fontSize: '10px', color: textSecondary, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
                Related
              </div>
              {doc.related.map((r) => (
                <div
                  key={r.id}
                  onClick={() => selectNode(r.id)}
                  style={{ padding: '4px 0', fontSize: '11px', color: isDark ? '#778' : '#555', cursor: 'pointer' }}
                >
                  {r.title}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ContentAccordion({ content, isDark }: { content: string; isDark: boolean }) {
  const sections = useMemo(() => {
    const parts: Array<{ heading: string; body: string }> = [];
    const lines = content.split('\n');
    let currentHeading = 'Overview';
    let currentBody: string[] = [];

    for (const line of lines) {
      const match = line.match(/^#{1,3}\s+(.+)$/);
      if (match) {
        if (currentBody.length > 0) {
          parts.push({ heading: currentHeading, body: currentBody.join('\n') });
        }
        currentHeading = match[1];
        currentBody = [];
      } else {
        currentBody.push(line);
      }
    }
    if (currentBody.length > 0) {
      parts.push({ heading: currentHeading, body: currentBody.join('\n') });
    }

    return parts;
  }, [content]);

  const bodyColor = isDark ? '#b0b0c0' : '#444';

  if (content.length < 500 || sections.length <= 1) {
    return (
      <div style={{ fontSize: '13px', lineHeight: 1.7, color: bodyColor }}>
        <Markdown>{content}</Markdown>
      </div>
    );
  }

  return (
    <div>
      {sections.map((sec, i) => (
        <AccordionSection key={i} heading={sec.heading} body={sec.body} defaultOpen={i === 0} isDark={isDark} />
      ))}
    </div>
  );
}

function AccordionSection({ heading, body, defaultOpen, isDark }: { heading: string; body: string; defaultOpen: boolean; isDark: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const trimmed = body.trim();
  if (!trimmed) return null;

  return (
    <div style={{ borderBottom: `1px solid ${isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.05)'}`, marginBottom: '4px' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          padding: '8px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
        }}
      >
        <span style={{
          fontSize: '10px', color: isDark ? '#556' : '#999', transition: 'transform 0.2s',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          display: 'inline-block',
        }}>
          ▶
        </span>
        <span style={{ fontSize: '12px', fontWeight: 600, color: isDark ? '#99a' : '#555' }}>
          {heading}
        </span>
      </button>
      {open && (
        <div style={{ fontSize: '13px', lineHeight: 1.7, color: isDark ? '#b0b0c0' : '#444', paddingBottom: '8px' }}>
          <Markdown>{trimmed}</Markdown>
        </div>
      )}
    </div>
  );
}
