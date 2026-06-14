// T2-4: in-note Find & Replace overlay.
//
// Works over BOTH editor surfaces without coupling to TipTap internals (the
// MarkdownEditor/SourceView components are owned by another agent):
//   • Live / Reading mode → the ProseMirror contenteditable (class `.sv-editor`).
//     Matches are highlighted non-destructively via the CSS Custom Highlight API
//     (no DOM mutation → no fight with ProseMirror's own DOM observer). Replace
//     selects the match Range and uses execCommand('insertText'); ProseMirror's
//     observer picks that up and keeps its model + onUpdate (→ save) in sync.
//   • Source mode → the plain <textarea.sv-source-view>: value splice + native
//     'input' event so React's onChange fires and the tab updates.
//
// Opened by the editor.find (Ctrl+F) / editor.replace (Ctrl+H) commands, which
// set ui.findReplaceMode. The overlay floats top-right over the editor pane.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useUiStore } from '../../lib/commands.js';

const HIGHLIGHT_NAME = 'sv-find';
const HIGHLIGHT_ACTIVE = 'sv-find-active';
const supportsHighlightApi =
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof (globalThis as any).Highlight === 'function';

interface Match {
  // Source (textarea): character offsets into value.
  start: number;
  end: number;
}

/** The contenteditable ProseMirror root, or null. Prefers the focused pane. */
function findContentEditable(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active?.classList?.contains('sv-editor') && active.isContentEditable) return active;
  // Fall back to the first editor surface on screen.
  const el = document.querySelector('.sv-editor[contenteditable="true"]') as HTMLElement | null;
  return el;
}

function findTextarea(): HTMLTextAreaElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active instanceof HTMLTextAreaElement && active.classList.contains('sv-source-view')) return active;
  return document.querySelector('textarea.sv-source-view');
}

/** All text nodes under a root, in document order. */
function collectTextNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) out.push(n as Text);
  return out;
}

export function FindReplace() {
  const mode = useUiStore((s) => s.findReplaceMode);
  const setMode = useUiStore((s) => s.setFindReplaceMode);

  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [current, setCurrent] = useState(0); // 1-based index of active match; 0 = none
  const findInputRef = useRef<HTMLInputElement>(null);

  // Which surface is the search target — captured when the overlay opens so it
  // doesn't jump to a different pane while the user types in the overlay inputs.
  const targetRef = useRef<{ kind: 'ce'; el: HTMLElement } | { kind: 'ta'; el: HTMLTextAreaElement } | null>(null);

  const open = mode !== null;

  // Capture the active editor surface on open + focus the find box.
  useEffect(() => {
    if (!open) return;
    const ta = findTextarea();
    if (ta) targetRef.current = { kind: 'ta', el: ta };
    else {
      const ce = findContentEditable();
      targetRef.current = ce ? { kind: 'ce', el: ce } : null;
    }
    setTimeout(() => { findInputRef.current?.focus(); findInputRef.current?.select(); }, 30);
  }, [open]);

  // ─── Highlight registry teardown ───
  const clearHighlights = useCallback(() => {
    if (!supportsHighlightApi) return;
    (CSS as any).highlights.delete(HIGHLIGHT_NAME);
    (CSS as any).highlights.delete(HIGHLIGHT_ACTIVE);
  }, []);

  // Build the list of ranges/offsets for the current query against the target.
  const computeMatches = useCallback((): { ce?: Range[]; ta?: Match[] } => {
    const target = targetRef.current;
    if (!target || !find) return {};
    const needle = caseSensitive ? find : find.toLowerCase();
    if (target.kind === 'ta') {
      const hay = caseSensitive ? target.el.value : target.el.value.toLowerCase();
      const out: Match[] = [];
      let i = hay.indexOf(needle);
      while (i !== -1) {
        out.push({ start: i, end: i + needle.length });
        i = hay.indexOf(needle, i + Math.max(1, needle.length));
      }
      return { ta: out };
    }
    // contenteditable: walk text nodes, build ranges across the flat text.
    const nodes = collectTextNodes(target.el);
    const ranges: Range[] = [];
    for (const node of nodes) {
      const text = caseSensitive ? node.data : node.data.toLowerCase();
      let i = text.indexOf(needle);
      while (i !== -1) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + needle.length);
        ranges.push(r);
        i = text.indexOf(needle, i + Math.max(1, needle.length));
      }
    }
    return { ce: ranges };
  }, [find, caseSensitive]);

  // Paint highlights + move the active match into view. activeIdx is 0-based.
  const paint = useCallback((activeIdx: number) => {
    const target = targetRef.current;
    if (!target) { setMatchCount(0); setCurrent(0); return; }

    if (target.kind === 'ta') {
      const { ta = [] } = computeMatches();
      setMatchCount(ta.length);
      if (ta.length === 0) { setCurrent(0); return; }
      const idx = ((activeIdx % ta.length) + ta.length) % ta.length;
      setCurrent(idx + 1);
      const m = ta[idx];
      // Select the active match in the textarea (visible highlight + scroll).
      target.el.focus();
      target.el.setSelectionRange(m.start, m.end);
      return;
    }

    // contenteditable
    if (!supportsHighlightApi) { setMatchCount(0); setCurrent(0); return; }
    const { ce = [] } = computeMatches();
    setMatchCount(ce.length);
    clearHighlights();
    if (ce.length === 0) { setCurrent(0); return; }
    const idx = ((activeIdx % ce.length) + ce.length) % ce.length;
    setCurrent(idx + 1);
    const all = new (globalThis as any).Highlight(...ce);
    const active = new (globalThis as any).Highlight(ce[idx]);
    (CSS as any).highlights.set(HIGHLIGHT_NAME, all);
    (CSS as any).highlights.set(HIGHLIGHT_ACTIVE, active);
    try {
      const rect = ce[idx].getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        ce[idx].startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } catch { /* range detached — ignore */ }
  }, [computeMatches, clearHighlights]);

  // Re-highlight whenever the query / case flag changes (reset to first match).
  useEffect(() => {
    if (!open) return;
    paint(0);
  }, [open, find, caseSensitive, paint]);

  // Clean up highlights when the overlay closes.
  useEffect(() => {
    if (open) return;
    clearHighlights();
  }, [open, clearHighlights]);

  const go = useCallback((delta: number) => {
    if (matchCount === 0) { paint(0); return; }
    paint((current - 1) + delta);
  }, [matchCount, current, paint]);

  const close = useCallback(() => {
    clearHighlights();
    setMode(null);
    targetRef.current?.el.focus();
  }, [clearHighlights, setMode]);

  // ─── Replace ───
  const replaceCurrent = useCallback(() => {
    const target = targetRef.current;
    if (!target || !find || matchCount === 0) return;

    if (target.kind === 'ta') {
      const { ta = [] } = computeMatches();
      if (ta.length === 0) return;
      const idx = (((current - 1) % ta.length) + ta.length) % ta.length;
      const m = ta[idx];
      const el = target.el;
      const next = el.value.slice(0, m.start) + replace + el.value.slice(m.end);
      // Native setter + 'input' event so React's controlled onChange fires.
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const caret = m.start + replace.length;
      el.setSelectionRange(caret, caret);
      // Re-search; keep cursor near the replaced spot.
      setTimeout(() => paint(idx), 0);
      return;
    }

    // contenteditable: select the active range, then execCommand insertText.
    const { ce = [] } = computeMatches();
    if (ce.length === 0) return;
    const idx = (((current - 1) % ce.length) + ce.length) % ce.length;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(ce[idx]);
    target.el.focus();
    // ProseMirror observes this DOM mutation and updates its model + fires onUpdate.
    document.execCommand('insertText', false, replace);
    setTimeout(() => paint(idx), 0);
  }, [find, replace, matchCount, current, computeMatches, paint]);

  const replaceAll = useCallback(() => {
    const target = targetRef.current;
    if (!target || !find) return;

    if (target.kind === 'ta') {
      const el = target.el;
      const flags = caseSensitive ? 'g' : 'gi';
      const re = new RegExp(escapeRegExp(find), flags);
      const next = el.value.replace(re, replace);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => paint(0), 0);
      return;
    }

    // contenteditable: replace from last match to first so earlier ranges stay valid.
    const { ce = [] } = computeMatches();
    if (ce.length === 0) return;
    const sel = window.getSelection();
    if (!sel) return;
    target.el.focus();
    for (let i = ce.length - 1; i >= 0; i--) {
      sel.removeAllRanges();
      sel.addRange(ce[i]);
      document.execCommand('insertText', false, replace);
    }
    setTimeout(() => paint(0), 0);
  }, [find, replace, caseSensitive, computeMatches, paint]);

  const onFindKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
  }, [close, go]);

  const countLabel = useMemo(
    () => (find ? (matchCount === 0 ? 'No results' : `${current}/${matchCount}`) : ''),
    [find, matchCount, current],
  );

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, background: 'var(--hover)', border: '1px solid var(--border)',
    borderRadius: 4, padding: '4px 8px', fontSize: 12, color: 'var(--ink)', outline: 'none',
  };
  const btnStyle: React.CSSProperties = {
    padding: '4px 8px', fontSize: 11, cursor: 'pointer', background: 'transparent',
    border: '1px solid var(--border)', borderRadius: 4, color: 'var(--ink-dim)',
  };

  return (
    <>
      <style>{`
        ::highlight(${HIGHLIGHT_NAME}) { background: #fbbf2466; color: inherit; }
        ::highlight(${HIGHLIGHT_ACTIVE}) { background: var(--accent); color: #fff; }
      `}</style>
      <div
        role="dialog"
        aria-label="Find and replace"
        style={{
          position: 'absolute', top: 12, right: 24, zIndex: 50, width: 320,
          background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 28px rgba(0,0,0,0.4)', padding: 8,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            ref={findInputRef}
            type="text"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={onFindKeyDown}
            placeholder="Find"
            aria-label="Find"
            style={inputStyle}
          />
          <span style={{ fontSize: 10, color: 'var(--ink-faint)', minWidth: 48, textAlign: 'right' }}>
            {countLabel}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={() => go(-1)} disabled={matchCount === 0} title="Previous (Shift+Enter)" aria-label="Previous match" style={btnStyle}>↑</button>
          <button onClick={() => go(1)} disabled={matchCount === 0} title="Next (Enter)" aria-label="Next match" style={btnStyle}>↓</button>
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            title="Match case"
            aria-pressed={caseSensitive}
            aria-label="Match case"
            style={{
              ...btnStyle, fontWeight: 700,
              color: caseSensitive ? 'var(--accent-2)' : 'var(--ink-faint)',
              background: caseSensitive ? 'var(--selection)' : 'transparent',
            }}
          >
            Aa
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={close} title="Close (Esc)" aria-label="Close find" style={btnStyle}>✕</button>
        </div>

        {mode === 'replace' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}
              placeholder="Replace"
              aria-label="Replace with"
              style={inputStyle}
            />
            <button onClick={replaceCurrent} disabled={matchCount === 0} title="Replace" aria-label="Replace" style={btnStyle}>Replace</button>
            <button onClick={replaceAll} disabled={matchCount === 0} title="Replace all" aria-label="Replace all" style={btnStyle}>All</button>
          </div>
        )}
      </div>
    </>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
