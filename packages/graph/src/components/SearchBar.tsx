// 검색바 — 상단 헤더에 통합, 결과 수 표시, 검색 히스토리

import { useRef, useState } from 'react';
import { useSearch } from '../hooks/useSearch.js';
import { useGraphStore } from '../stores/graph-store.js';

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
          onFocus={() => setShowHistory(true)}
          onBlur={() => setTimeout(() => setShowHistory(false), 200)}
          onKeyDown={(e) => { if (e.key === 'Escape') { clearSearch(); setShowHistory(false); inputRef.current?.blur(); } }}
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: isDark ? '#c0c0f0' : '#2a2a4a',
            fontSize: '12px', padding: '5px 0',
            width: '160px',
          }}
        />
        {query && (
          <button
            onClick={clearSearch}
            style={{
              background: 'none', border: 'none',
              color: isDark ? '#556' : '#999',
              cursor: 'pointer', fontSize: '12px', padding: '0 2px',
            }}
          >
            x
          </button>
        )}

        {/* 검색 히스토리 드롭다운 */}
        {showHistory && !query && searchHistory.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: '4px',
            background: isDark ? 'rgba(10,10,20,0.95)' : 'rgba(255,255,255,0.97)',
            border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
            borderRadius: '8px', padding: '4px', minWidth: '220px',
            backdropFilter: 'blur(8px)', zIndex: 100,
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
