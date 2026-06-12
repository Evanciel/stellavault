// Outline Panel (Stage C, plan W1-5) — heading tree of the active tab.
// Headings are parsed from the tab's markdown source (store), skipping code
// fences. Clicking a heading dispatches CustomEvent('sv:scroll-to-heading');
// MarkdownEditor.tsx listens and scrolls the matching heading into view.
// No IPC needed.

import { useMemo } from 'react';
import { useAppStore } from '../../stores/app-store.js';

export interface OutlineHeading {
  level: number;        // 1..6
  raw: string;          // heading text as written in markdown
  text: string;         // plain text (inline markdown stripped) — matches TipTap textContent
  index: number;        // nth heading with this same plain text (disambiguates duplicates)
  line: number;
}

/** Strip inline markdown so the text matches the editor node's textContent. */
function stripInlineMd(s: string): string {
  return s
    .replace(/`([^`]*)`/g, '$1')                       // inline code
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')     // [[target|alias]]
    .replace(/\[\[([^\]]+)\]\]/g, '$1')                // [[wikilink]]
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')         // [label](url) / images
    .replace(/(\*\*|__)(.*?)\1/g, '$2')                // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')                   // italic
    .replace(/~~(.*?)~~/g, '$1')                       // strikethrough
    .trim();
}

/** Parse ATX headings from markdown, skipping fenced code blocks. */
export function parseHeadings(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const seen = new Map<string, number>();
  let inFence = false;
  let fenceMarker = '';
  const lines = markdown.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const raw = m[2];
    const text = stripInlineMd(raw);
    const index = seen.get(text) ?? 0;
    seen.set(text, index + 1);
    headings.push({ level: m[1].length, raw, text, index, line: i });
  }
  return headings;
}

export function OutlinePanel() {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId));

  const headings = useMemo(
    () => parseHeadings(activeTab?.content ?? ''),
    [activeTab?.content],
  );

  if (!activeTab) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
        Open a note to see its outline.
      </div>
    );
  }

  if (headings.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
        No headings in this note.
      </div>
    );
  }

  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <div style={{ padding: '8px 4px' }}>
      {headings.map((h, i) => (
        <div
          key={`${h.line}-${i}`}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('sv:scroll-to-heading', {
              detail: { text: h.text, index: h.index },
            }));
          }}
          title={h.text}
          style={{
            padding: '4px 10px',
            paddingLeft: 10 + (h.level - minLevel) * 14,
            fontSize: h.level <= 2 ? 12 : 11,
            fontWeight: h.level === 1 ? 600 : h.level === 2 ? 500 : 400,
            color: h.level <= 2 ? 'var(--ink)' : 'var(--ink-dim)',
            cursor: 'pointer',
            borderRadius: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--hover)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        >
          {h.text}
        </div>
      ))}
    </div>
  );
}
