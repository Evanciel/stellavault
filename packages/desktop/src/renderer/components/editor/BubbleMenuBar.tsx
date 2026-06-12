// Selection bubble menu (Notion model — benchmark spec §1b/P0).
// Appears on text selection: B/I/U/S/code, text-color palette, highlight
// palette, link add/edit (inline input), clear formatting.
// Hidden inside code blocks and on node selections (images, wikilinks).

import { useEffect, useState } from 'react';
import { BubbleMenu, type Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';

// Shared palettes (also used by MarkdownEditor's toolbar dropdowns).
// Naver-style preset palette: 8 text colors + 8 highlight colors.
export const TEXT_COLORS = [
  { name: 'Red',    value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green',  value: '#22c55e' },
  { name: 'Blue',   value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink',   value: '#ec4899' },
  { name: 'Gray',   value: '#9ca3af' },
] as const;

export const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: '#facc1555' },
  { name: 'Green',  value: '#4ade8055' },
  { name: 'Blue',   value: '#60a5fa55' },
  { name: 'Purple', value: '#c084fc55' },
  { name: 'Pink',   value: '#f472b655' },
  { name: 'Orange', value: '#fb923c55' },
  { name: 'Red',    value: '#f8717155' },
  { name: 'Gray',   value: '#9ca3af55' },
] as const;

type Panel = 'color' | 'highlight' | 'link' | null;

export function BubbleMenuBar({ editor }: { editor: Editor }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [linkValue, setLinkValue] = useState('');

  // Close any open panel when the selection changes (menu repositions).
  useEffect(() => {
    const onSelection = () => setPanel(null);
    editor.on('selectionUpdate', onSelection);
    return () => { editor.off('selectionUpdate', onSelection); };
  }, [editor]);

  const openLink = () => {
    setLinkValue((editor.getAttributes('link').href as string | undefined) ?? '');
    setPanel(panel === 'link' ? null : 'link');
  };

  const applyLink = () => {
    const href = linkValue.trim();
    if (href) {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    }
    setPanel(null);
  };

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{ duration: 120, maxWidth: 'none' }}
      shouldShow={({ editor: e, state }) => {
        if (state.selection.empty) return false;
        if (state.selection instanceof NodeSelection) return false;
        if (e.isActive('codeBlock')) return false;
        return true;
      }}
    >
      <div className="sv-bubble">
        <BubbleBtn active={editor.isActive('bold')} title="Bold (Ctrl+B)" onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></BubbleBtn>
        <BubbleBtn active={editor.isActive('italic')} title="Italic (Ctrl+I)" onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></BubbleBtn>
        <BubbleBtn active={editor.isActive('underline')} title="Underline (Ctrl+U)" onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></BubbleBtn>
        <BubbleBtn active={editor.isActive('strike')} title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></BubbleBtn>
        <BubbleBtn active={editor.isActive('code')} title="Inline code (Ctrl+E)" onClick={() => editor.chain().focus().toggleCode().run()}>
          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{'<>'}</span>
        </BubbleBtn>

        <span className="sv-bubble-sep" />

        <BubbleBtn
          active={panel === 'color' || !!editor.getAttributes('textStyle').color}
          title="Text color"
          onClick={() => setPanel(panel === 'color' ? null : 'color')}
        >
          <span style={{ color: (editor.getAttributes('textStyle').color as string) || 'var(--ink)' }}>A</span>
        </BubbleBtn>
        <BubbleBtn
          active={panel === 'highlight' || editor.isActive('highlight')}
          title="Highlight color"
          onClick={() => setPanel(panel === 'highlight' ? null : 'highlight')}
        >
          <span style={{ background: '#facc1555', padding: '0 3px', borderRadius: 2 }}>A</span>
        </BubbleBtn>

        <span className="sv-bubble-sep" />

        <BubbleBtn active={editor.isActive('link') || panel === 'link'} title="Add / edit link" onClick={openLink}>🔗</BubbleBtn>
        <BubbleBtn active={false} title="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().run()}>
          <span style={{ fontSize: 11 }}>⌫A</span>
        </BubbleBtn>

        {panel === 'color' && (
          <div className="sv-bubble-panel">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.value}
                className="sv-swatch"
                title={c.name}
                aria-label={`Text color ${c.name}`}
                style={{ background: c.value }}
                onClick={() => { editor.chain().focus().setTextColor(c.value).run(); setPanel(null); }}
              />
            ))}
            <button className="sv-swatch-reset" onClick={() => { editor.chain().focus().unsetTextColor().run(); setPanel(null); }}>
              Reset
            </button>
          </div>
        )}

        {panel === 'highlight' && (
          <div className="sv-bubble-panel">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value}
                className="sv-swatch"
                title={c.name}
                aria-label={`Highlight ${c.name}`}
                style={{ background: c.value }}
                onClick={() => { editor.chain().focus().setHighlight({ color: c.value }).run(); setPanel(null); }}
              />
            ))}
            <button className="sv-swatch-reset" onClick={() => { editor.chain().focus().unsetHighlight().run(); setPanel(null); }}>
              Reset
            </button>
          </div>
        )}

        {panel === 'link' && (
          <div className="sv-bubble-panel" style={{ width: 260 }}>
            <input
              autoFocus
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
                if (e.key === 'Escape') setPanel(null);
              }}
              placeholder="https://… (empty = remove)"
              aria-label="Link URL"
              className="sv-bubble-input"
            />
            <button className="sv-swatch-reset" onClick={applyLink}>Apply</button>
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}

function BubbleBtn({ active, title, onClick, children }: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      className={`sv-bubble-btn${active ? ' sv-bubble-active' : ''}`}
    >
      {children}
    </button>
  );
}
