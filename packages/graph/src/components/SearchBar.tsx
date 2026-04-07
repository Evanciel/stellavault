// 검색바 — 결과 목록 드롭다운 + 노드 하이라이트 + 히스토리

import { useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { useSearch } from '../hooks/useSearch.js';
import { useGraphStore } from '../stores/graph-store.js';
import { fetchSearch } from '../api/client.js';

interface SearchResult {
  documentId: string;
  title: string;
  snippet: string;
  score: number;
}

export function SearchBar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { search, clearSearch } = useSearch();
  const query = useGraphStore((s) => s.searchQuery);
  const highlightedCount = useGraphStore((s) => s.highlightedNodeIds.size);
  const searchHistory = useGraphStore((s) => s.searchHistory);
  const clearSearchHistory = useGraphStore((s) => s.clearSearchHistory);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';
  const [showHistory, setShowHistory] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 검색 결과 목록 가져오기
  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetchSearch(query, 10);
        const items: SearchResult[] = (res.results ?? []).map((r: any) => ({
          documentId: r.documentId,
          title: r.title ?? r.filePath?.split('/').pop()?.replace('.md', '') ?? 'Untitled',
          snippet: (r.content ?? '').replace(/^---[\s\S]*?---\n?/, '').replace(/^#+\s+.+\n/m, '').trim().slice(0, 120),
          score: r.score ?? 0,
        }));
        setResults(items);
        setShowResults(items.length > 0);
      } catch {
        setResults([]);
      }
    }, 400);
  }, [query]);

  const handleResultClick = (result: SearchResult) => {
    const store = useGraphStore.getState();
    // 노드 찾기 — documentId 또는 title로 매칭
    const node = store.nodes.find(n =>
      n.id === result.documentId ||
      n.label === result.title
    );

    if (node) {
      store.selectNode(node.id);
      store.setHighlightedNodes([node.id]);

      // 카메라 이동
      if (node.position) {
        const controls = (window as any).__sv_controls?.current;
        if (controls) {
          const target = new THREE.Vector3(...node.position);
          const startTarget = controls.target.clone();
          const startPos = controls.object.position.clone();
          const dir = startPos.clone().sub(target).normalize();
          const endPos = target.clone().add(dir.multiplyScalar(200));
          let t = 0;
          function animate() {
            t += 0.03;
            if (t > 1) t = 1;
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            controls.target.lerpVectors(startTarget, target, ease);
            controls.object.position.lerpVectors(startPos, endPos, ease);
            controls.update();
            if (t < 1) requestAnimationFrame(animate);
          }
          requestAnimationFrame(animate);
        }
      }
    }
    setShowResults(false);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{
        position: 'relative',
        display: 'flex', alignItems: 'center',
        background: isDark ? 'rgba(100, 120, 255, 0.06)' : 'rgba(0, 0, 0, 0.03)',
        border: `1px solid ${isDark ? 'rgba(100, 120, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)'}`,
        borderRadius: '6px', padding: '0 10px',
      }}>
        <span style={{ fontSize: '12px', color: isDark ? '#556' : '#999', marginRight: '6px' }}>
          {'\u{1F50D}'}
        </span>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search knowledge..."
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => { setShowHistory(true); if (results.length > 0) setShowResults(true); }}
          onBlur={() => setTimeout(() => { setShowHistory(false); setShowResults(false); }, 250)}
          onKeyDown={(e) => { if (e.key === 'Escape') { clearSearch(); setShowHistory(false); setShowResults(false); inputRef.current?.blur(); } }}
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: isDark ? '#c0c0f0' : '#2a2a4a',
            fontSize: '12px', padding: '5px 0',
            width: '200px',
          }}
        />
        {query && (
          <button
            onClick={() => { clearSearch(); setResults([]); setShowResults(false); }}
            style={{
              background: 'none', border: 'none',
              color: isDark ? '#556' : '#999',
              cursor: 'pointer', fontSize: '12px', padding: '0 2px',
            }}
          >
            x
          </button>
        )}

        {/* 검색 결과 드롭다운 */}
        {showResults && results.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: '4px',
            background: isDark ? 'rgba(10,10,20,0.97)' : 'rgba(255,255,255,0.98)',
            border: `1px solid ${isDark ? 'rgba(100,120,255,0.2)' : 'rgba(0,0,0,0.1)'}`,
            borderRadius: '10px', padding: '6px', minWidth: '360px', maxWidth: '480px',
            backdropFilter: 'blur(12px)', zIndex: 200,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            maxHeight: '400px', overflowY: 'auto',
          }}>
            <div style={{ padding: '4px 8px 8px', fontSize: '10px', color: isDark ? '#667' : '#999', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              {results.length} results for "{query}"
            </div>
            {results.map((r, i) => (
              <div
                key={r.documentId + i}
                onMouseDown={(e) => { e.preventDefault(); handleResultClick(r); }}
                style={{
                  padding: '10px 12px', cursor: 'pointer', borderRadius: '8px',
                  borderBottom: i < results.length - 1 ? `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}` : 'none',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget).style.background = isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.04)'; }}
                onMouseLeave={(e) => { (e.currentTarget).style.background = 'transparent'; }}
              >
                <div style={{ fontSize: '13px', color: isDark ? '#dde' : '#222', fontWeight: 500, marginBottom: '4px' }}>
                  {r.title}
                </div>
                <div style={{ fontSize: '11px', color: isDark ? '#778' : '#888', lineHeight: 1.4 }}>
                  {r.snippet || 'No preview available'}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 검색 히스토리 드롭다운 */}
        {showHistory && !query && searchHistory.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: '4px',
            background: isDark ? 'rgba(10,10,20,0.95)' : 'rgba(255,255,255,0.97)',
            border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
            borderRadius: '8px', padding: '4px', minWidth: '220px',
            backdropFilter: 'blur(8px)', zIndex: 200,
            boxShadow: isDark ? 'none' : '0 4px 16px rgba(0,0,0,0.08)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 6px', marginBottom: '2px' }}>
              <span style={{ fontSize: '9px', color: isDark ? '#556' : '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Recent
              </span>
              <button
                onMouseDown={(e) => { e.preventDefault(); clearSearchHistory(); }}
                style={{
                  fontSize: '9px', color: isDark ? '#556' : '#999', background: 'none', border: 'none',
                  cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                Clear
              </button>
            </div>
            {searchHistory.slice(0, 10).map((q) => (
              <div
                key={q}
                onMouseDown={(e) => { e.preventDefault(); search(q); setShowHistory(false); }}
                style={{
                  padding: '4px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '4px',
                  color: isDark ? '#aab' : '#444',
                }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.04)'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
              >
                {q}
              </div>
            ))}
          </div>
        )}
      </div>
      {query && highlightedCount > 0 && (
        <span style={{ fontSize: '11px', color: isDark ? '#88aaff' : '#5577cc' }}>
          {highlightedCount} found
        </span>
      )}
    </div>
  );
}
