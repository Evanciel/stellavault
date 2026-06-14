// TipTap-based markdown editor — full-featured with 15+ extensions.
// Supports: tables, task lists, code highlighting, images, math (future),
// underline, highlight, superscript/subscript, text alignment, typography.
//
// B1: `content` in/out is ALWAYS markdown source (never HTML). The Markdown
// extension parses incoming markdown; onUpdate serializes back via
// editorToMarkdown — see ../../lib/markdown.ts (plan §4-A).

import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Underline from '@tiptap/extension-underline';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import TextAlign from '@tiptap/extension-text-align';
import Typography from '@tiptap/extension-typography';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { CodeBlockView } from './CodeBlockView.js';
import { WikilinkExtension } from './WikilinkSuggestion.js';
import { WikilinkNode } from './WikilinkNode.js';
import { SlashCommandExtension } from './SlashCommands.js';
import { MathExtension } from './MathExtension.js';
import { MarkdownSerializerExtension, MarkdownHighlight, MarkdownTextColor, editorToMarkdown, markdownToEditor } from '../../lib/markdown.js';
import { CalloutNode, CALLOUT_TYPES } from './CalloutNode.js';
import { BubbleMenuBar, TEXT_COLORS, HIGHLIGHT_COLORS } from './BubbleMenuBar.js';
import { TableControls } from './TableControls.js';
import { PromptModal } from '../ui/Modal.js';
import { ipc } from '../../lib/ipc-client.js';

const lowlight = createLowlight(common);

// T2-1: render vault-relative image sources (e.g. assets/x.png) via the
// app://vault/<relpath> protocol so they actually load in-editor under CSP.
// CRUCIAL: this only touches the RENDERED <img src>. The ProseMirror node's
// `src` attribute is left untouched, so tiptap-markdown serializes the original
// plain relative path back out → markdown round-trip is preserved (the on-disk
// note never sees app://). Absolute URLs (http(s), data:, blob:, file:, already
// app://) and root-absolute paths are passed through unchanged.
function toAssetUrl(src: string): string {
  if (!src) return src;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src; // has a scheme — leave it
  if (src.startsWith('//') || src.startsWith('/')) return src; // protocol-/root-absolute
  // Vault-relative: encode each path segment (spaces, CJK) but keep the slashes.
  const encoded = src.split('/').map(encodeURIComponent).join('/');
  return `app://vault/${encoded}`;
}

// Override only renderHTML: rewrite src for display, preserve the stored attr.
const VaultImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes };
    if (typeof attrs.src === 'string') attrs.src = toAssetUrl(attrs.src);
    return ['img', attrs];
  },
});

interface Props {
  // W1-7: markdown BODY source (never HTML, never frontmatter — EditorArea
  // splits/recombines the YAML block via lib/frontmatter.ts).
  content: string;
  onChange: (content: string) => void;  // emits markdown body source
}

export function MarkdownEditor({ content, onChange }: Props) {
  const [imagePromptOpen, setImagePromptOpen] = useState(false);
  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  // Toolbar dropdown palettes (text color / highlight / callout type)
  const [openPalette, setOpenPalette] = useState<'color' | 'highlight' | 'callout' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [
      MarkdownSerializerExtension,
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false, // Replaced by CodeBlockLowlight
      }),
      // T1-14: React NodeView adds a language picker + copy button. The
      // `language` attr round-trips to ```<lang> fences via tiptap-markdown.
      CodeBlockLowlight
        .extend({ addNodeView() { return ReactNodeViewRenderer(CodeBlockView); } })
        .configure({ lowlight, HTMLAttributes: { class: 'sv-code-block' } }),
      Placeholder.configure({ placeholder: 'Start writing... (type / for commands)' }),
      Link.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      MarkdownHighlight.configure({ multicolor: true }),
      MarkdownTextColor,   // text color via TextStyle attr → <span style="color:…"> in md
      CalloutNode,         // proper callout node → > [!type] in md
      Underline,
      Superscript,
      Subscript,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Typography,
      VaultImage.configure({ inline: false, allowBase64: true }), // T2-1: app:// src rewrite for vault-relative images
      WikilinkNode,      // W1-9: real [[wikilink]] node (parse/serialize + click-nav)
      WikilinkExtension, // [[ autocomplete — inserts WikilinkNode
      SlashCommandExtension,
      MathExtension,
    ],
    content: markdownToEditor(content),  // Markdown extension parses this as markdown
    onUpdate: ({ editor: e }) => {
      onChange(editorToMarkdown(e));
    },
    editorProps: {
      attributes: {
        class: 'sv-editor',
        spellcheck: 'true',
      },
      handleDrop: (view, event) => {
        // Handle image drops
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
          const file = files[0];
          if (file.type.startsWith('image/')) {
            event.preventDefault();
            const reader = new FileReader();
            reader.onload = () => {
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
              if (pos != null && typeof reader.result === 'string') {
                view.dispatch(view.state.tr.insert(pos,
                  view.state.schema.nodes.image.create({ src: reader.result })
                ));
              }
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
      handlePaste: (view, event) => {
        // Handle image paste from clipboard
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of items) {
            if (item.type.startsWith('image/')) {
              event.preventDefault();
              const file = item.getAsFile();
              if (!file) continue;
              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result === 'string') {
                  const { state: { tr, selection }, dispatch } = view;
                  const node = view.state.schema.nodes.image.create({ src: reader.result });
                  dispatch(tr.insert(selection.head, node));
                }
              };
              reader.readAsDataURL(file);
              return true;
            }
          }
        }
        return false;
      },
    },
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  // ─── Stage C (W1-5, OutlinePanel) — scroll-to-heading listener ONLY ───
  // OutlinePanel dispatches CustomEvent('sv:scroll-to-heading', {detail:{text,index}})
  // where `text` is the heading's plain text and `index` disambiguates duplicates
  // (nth heading with that same text). We locate the matching heading node in the
  // ProseMirror doc and scroll its DOM node into view. Do not extend this block.
  useEffect(() => {
    if (!editor) return;
    const onScrollToHeading = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string; index: number }>).detail;
      if (!detail || typeof detail.text !== 'string') return;
      let seen = 0;
      let targetPos: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (targetPos !== null) return false;
        if (node.type.name === 'heading' && node.textContent.trim() === detail.text) {
          if (seen === (detail.index ?? 0)) {
            targetPos = pos;
            return false;
          }
          seen++;
        }
        return true;
      });
      if (targetPos !== null) {
        const dom = editor.view.nodeDOM(targetPos);
        if (dom instanceof HTMLElement) {
          dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    };
    window.addEventListener('sv:scroll-to-heading', onScrollToHeading);
    return () => window.removeEventListener('sv:scroll-to-heading', onScrollToHeading);
  }, [editor]);
  // ─── end Stage C scroll-to-heading listener ───

  if (!editor) return null;

  const Sep = () => <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />;

  // Local image import — file picker → IPC 'vault:import-asset' copies the
  // bytes into <vault>/assets/ and returns a vault-relative path (Obsidian-
  // compatible markdown: ![](assets/name.png)).
  async function importLocalImage(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const rel = await ipc('vault:import-asset', { base64: btoa(bin), fileName: file.name });
      editor?.chain().focus().setImage({ src: rel }).run();
    } catch (err) {
      console.error('[editor] local image import failed:', err);
    }
  }

  // Small dropdown wrapper for toolbar palettes.
  const Palette = ({ children }: { children: React.ReactNode }) => (
    <div className="sv-toolbar-pop" role="menu">{children}</div>
  );

  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        gap: 2,
        marginBottom: 16,
        padding: '4px 0',
        borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}>
        {/* Text formatting */}
        <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="B" title="Bold (Ctrl+B)" style={{ fontWeight: 700 }} />
        <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="I" title="Italic (Ctrl+I)" style={{ fontStyle: 'italic' }} />
        <ToolBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} label="U" title="Underline (Ctrl+U)" style={{ textDecoration: 'underline' }} />
        <ToolBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} label="S" title="Strikethrough" style={{ textDecoration: 'line-through' }} />
        <ToolBtn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} label="<>" title="Inline code (Ctrl+E)" style={{ fontFamily: 'monospace', fontSize: '10px' }} />

        <Sep />

        {/* Color palettes (text color + highlight color — Naver-style separate pickers) */}
        <div style={{ position: 'relative' }}>
          <ToolBtn
            active={openPalette === 'color' || !!editor.getAttributes('textStyle').color}
            onClick={() => setOpenPalette(openPalette === 'color' ? null : 'color')}
            label="A"
            title="Text color"
            style={{ color: (editor.getAttributes('textStyle').color as string) || undefined, fontWeight: 700 }}
          />
          {openPalette === 'color' && (
            <Palette>
              {TEXT_COLORS.map((c) => (
                <button key={c.value} className="sv-swatch" title={c.name} aria-label={`Text color ${c.name}`} style={{ background: c.value }}
                  onClick={() => { editor.chain().focus().setTextColor(c.value).run(); setOpenPalette(null); }} />
              ))}
              <button className="sv-swatch-reset" onClick={() => { editor.chain().focus().unsetTextColor().run(); setOpenPalette(null); }}>Reset</button>
            </Palette>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <ToolBtn
            active={openPalette === 'highlight' || editor.isActive('highlight')}
            onClick={() => setOpenPalette(openPalette === 'highlight' ? null : 'highlight')}
            label="H"
            title="Highlight color"
            style={{ background: '#fbbf2440', padding: '3px 7px' }}
          />
          {openPalette === 'highlight' && (
            <Palette>
              <button className="sv-swatch" title="Default (==text==)" aria-label="Default highlight" style={{ background: '#fbbf2480' }}
                onClick={() => { editor.chain().focus().setHighlight().run(); setOpenPalette(null); }} />
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c.value} className="sv-swatch" title={c.name} aria-label={`Highlight ${c.name}`} style={{ background: c.value }}
                  onClick={() => { editor.chain().focus().setHighlight({ color: c.value }).run(); setOpenPalette(null); }} />
              ))}
              <button className="sv-swatch-reset" onClick={() => { editor.chain().focus().unsetHighlight().run(); setOpenPalette(null); }}>Reset</button>
            </Palette>
          )}
        </div>

        <Sep />

        {/* Headings */}
        {([1, 2, 3] as const).map((level) => (
          <ToolBtn key={level} active={editor.isActive('heading', { level })} onClick={() => editor.chain().focus().toggleHeading({ level }).run()} label={`H${level}`} title={`Heading ${level}`} />
        ))}

        <Sep />

        {/* Lists */}
        <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} label="•" title="Bullet list" />
        <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="1." title="Numbered list" />
        <ToolBtn active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} label="☑" title="Task list" />

        <Sep />

        {/* Blocks */}
        <ToolBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="❝" title="Quote" />
        <div style={{ position: 'relative' }}>
          <ToolBtn
            active={openPalette === 'callout' || editor.isActive('callout')}
            onClick={() => setOpenPalette(openPalette === 'callout' ? null : 'callout')}
            label="💡"
            title="Callout (info / warning / tip)"
          />
          {openPalette === 'callout' && (
            <Palette>
              {CALLOUT_TYPES.map((t) => (
                <button
                  key={t}
                  className="sv-swatch-reset"
                  onClick={() => {
                    if (editor.isActive('callout')) editor.chain().focus().setCalloutType(t).run();
                    else editor.chain().focus().toggleCallout(t).run();
                    setOpenPalette(null);
                  }}
                >
                  {t === 'info' ? 'ℹ️' : t === 'warning' ? '⚠️' : '💡'} {t}
                </button>
              ))}
              {editor.isActive('callout') && (
                <button className="sv-swatch-reset" onClick={() => { editor.chain().focus().toggleCallout().run(); setOpenPalette(null); }}>
                  Remove
                </button>
              )}
            </Palette>
          )}
        </div>
        <ToolBtn active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} label="{}" title="Code block" style={{ fontFamily: 'monospace', fontSize: '10px' }} />
        <ToolBtn active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()} label="—" title="Horizontal rule" />

        <Sep />

        {/* Table — row/col controls live in the TableControls context bar below */}
        <ToolBtn active={editor.isActive('table')} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} label="⊞" title="Insert table" />

        <Sep />

        {/* Alignment */}
        <ToolBtn active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} label="≡L" title="Align left" />
        <ToolBtn active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} label="≡C" title="Align center" />
        <ToolBtn active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} label="≡R" title="Align right" />

        <Sep />

        {/* Link */}
        <ToolBtn active={editor.isActive('link')} onClick={() => setLinkPromptOpen(true)} label="🔗" title="Insert / edit link" />

        {/* Image — URL, or local file copied into vault assets/ */}
        <ToolBtn active={false} onClick={() => setImagePromptOpen(true)} label="🖼" title="Insert image from URL (or paste/drop)" />
        <ToolBtn active={false} onClick={() => fileInputRef.current?.click()} label="🖼+" title="Insert image from local file (copied to assets/)" style={{ fontSize: '10px' }} />

        {/* Super/subscript */}
        <ToolBtn active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} label="x²" title="Superscript" style={{ fontSize: '10px' }} />
        <ToolBtn active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} label="x₂" title="Subscript" style={{ fontSize: '10px' }} />

        <Sep />

        {/* Math */}
        <ToolBtn active={false} onClick={() => {
          editor.chain().focus().insertContent('$$E = mc^2$$').run();
        }} label="∑" title="Insert math (KaTeX)" />

        {/* Slash hint */}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink-faint)', alignSelf: 'center', paddingRight: 4 }}>
          Type / for commands
        </span>
      </div>

      {/* Table context bar — appears when the cursor is inside a table */}
      <TableControls editor={editor} />

      {/* Notion-style selection bubble menu */}
      <BubbleMenuBar editor={editor} />

      <EditorContent editor={editor} />

      {/* Hidden file input for local image import */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        aria-label="Import local image"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importLocalImage(file);
          e.target.value = '';
        }}
      />

      <PromptModal
        open={imagePromptOpen}
        onClose={() => setImagePromptOpen(false)}
        onSubmit={(url) => editor.chain().focus().setImage({ src: url }).run()}
        title="Insert image"
        placeholder="https://… image URL"
        submitLabel="Insert"
      />

      <PromptModal
        open={linkPromptOpen}
        onClose={() => setLinkPromptOpen(false)}
        onSubmit={(url) => editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()}
        title="Insert link"
        placeholder="https://… URL"
        defaultValue={(editor.getAttributes('link').href as string) ?? ''}
        submitLabel="Apply"
      />

      <style>{`
        .sv-editor {
          outline: none;
          line-height: 1.7;
          font-size: 15px;
          color: var(--ink);
          min-height: 400px;
        }
        .sv-editor h1 { font-size: 28px; font-weight: 700; margin: 28px 0 8px; line-height: 1.2; }
        .sv-editor h2 { font-size: 22px; font-weight: 600; margin: 22px 0 6px; line-height: 1.3; }
        .sv-editor h3 { font-size: 18px; font-weight: 600; margin: 18px 0 4px; line-height: 1.3; }
        .sv-editor h4 { font-size: 16px; font-weight: 600; margin: 14px 0 4px; line-height: 1.4; }
        .sv-editor p { margin: 0 0 8px; }
        .sv-editor ul, .sv-editor ol { padding-left: 24px; margin: 4px 0 8px; }
        .sv-editor li { margin: 2px 0; }
        .sv-editor li p { margin: 0; }
        .sv-editor blockquote {
          border-left: 3px solid var(--accent);
          padding-left: 16px;
          margin: 8px 0;
          color: var(--ink-dim);
        }
        .sv-editor code {
          background: var(--hover);
          padding: 2px 5px;
          border-radius: 3px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.9em;
          color: var(--accent-2);
        }
        .sv-code-block {
          background: var(--bg-3) !important;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 14px 16px;
          margin: 8px 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          line-height: 1.5;
          overflow-x: auto;
        }
        .sv-code-block code { background: transparent; padding: 0; color: var(--ink); }
        /* T1-14: code block NodeView chrome (language picker + copy) */
        .sv-code-block-wrap {
          position: relative;
          margin: 8px 0;
        }
        .sv-code-block-wrap pre.sv-code-block { margin: 0; }
        .sv-code-block-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 4px 8px;
          background: var(--bg-3);
          border: 1px solid var(--border);
          border-bottom: none;
          border-radius: 6px 6px 0 0;
        }
        .sv-code-block-bar + pre.sv-code-block { border-radius: 0 0 6px 6px; }
        .sv-code-lang {
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--ink-dim);
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          padding: 2px 6px;
          cursor: pointer;
          outline: none;
        }
        .sv-code-copy {
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--ink-dim);
          font-size: 11px;
          padding: 2px 8px;
          cursor: pointer;
        }
        .sv-code-copy:hover { background: var(--hover); color: var(--ink); }
        /* Syntax highlighting (lowlight) */
        .sv-code-block .hljs-keyword { color: #c678dd; }
        .sv-code-block .hljs-string { color: #98c379; }
        .sv-code-block .hljs-number { color: #d19a66; }
        .sv-code-block .hljs-comment { color: var(--ink-faint); font-style: italic; }
        .sv-code-block .hljs-built_in { color: #e5c07b; }
        .sv-code-block .hljs-function { color: #61afef; }
        .sv-code-block .hljs-title { color: #61afef; }
        .sv-code-block .hljs-attr { color: #d19a66; }
        .sv-code-block .hljs-params { color: var(--ink); }

        .sv-editor a { color: var(--accent-2); text-decoration: underline; }
        /* W1-9 wikilink node */
        .sv-editor .sv-wikilink {
          color: var(--accent-2);
          cursor: pointer;
          border-radius: 3px;
          padding: 0 1px;
        }
        .sv-editor .sv-wikilink:hover {
          text-decoration: underline;
          background: var(--selection);
        }
        .sv-editor .sv-wikilink.ProseMirror-selectednode {
          outline: 1px solid var(--accent);
        }
        .sv-editor hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
        .sv-editor mark { background: #fbbf2440; color: inherit; padding: 1px 3px; border-radius: 2px; }
        .sv-editor img { max-width: 100%; border-radius: 6px; margin: 8px 0; }

        /* Tables */
        .sv-editor table {
          border-collapse: collapse;
          width: 100%;
          margin: 12px 0;
          font-size: 14px;
        }
        .sv-editor th, .sv-editor td {
          border: 1px solid var(--border);
          padding: 8px 12px;
          text-align: left;
          min-width: 80px;
        }
        .sv-editor th {
          background: var(--bg-3);
          font-weight: 600;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--ink-dim);
        }
        .sv-editor .selectedCell { background: var(--selection); }
        .sv-editor .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: 0;
          width: 4px;
          background: var(--accent);
          cursor: col-resize;
        }

        /* Task lists */
        .sv-editor ul[data-type="taskList"] {
          list-style: none;
          padding-left: 4px;
        }
        .sv-editor ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 8px;
        }
        .sv-editor ul[data-type="taskList"] li label {
          margin-top: 3px;
        }
        .sv-editor ul[data-type="taskList"] li[data-checked="true"] > div > p {
          text-decoration: line-through;
          color: var(--ink-faint);
        }

        /* Math (KaTeX) */
        .sv-math-inline {
          display: inline;
          margin: 0 2px;
        }
        .sv-math-display {
          text-align: center;
          margin: 16px 0;
          padding: 12px;
          background: var(--bg-3);
          border-radius: 6px;
        }

        /* Callouts (> [!type] in markdown) */
        .sv-editor .sv-callout {
          border: 1px solid var(--border);
          border-left: 3px solid #3b82f6;
          background: rgba(59, 130, 246, 0.08);
          border-radius: 6px;
          padding: 10px 14px;
          margin: 10px 0;
        }
        .sv-editor .sv-callout::before {
          content: 'ℹ️ Info';
          display: block;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          color: #60a5fa;
          margin-bottom: 4px;
        }
        .sv-editor .sv-callout[data-callout="warning"] {
          border-left-color: #f59e0b;
          background: rgba(245, 158, 11, 0.08);
        }
        .sv-editor .sv-callout[data-callout="warning"]::before { content: '⚠️ Warning'; color: #fbbf24; }
        .sv-editor .sv-callout[data-callout="tip"] {
          border-left-color: #22c55e;
          background: rgba(34, 197, 94, 0.08);
        }
        .sv-editor .sv-callout[data-callout="tip"]::before { content: '💡 Tip'; color: #4ade80; }
        .sv-editor .sv-callout p:last-child { margin-bottom: 0; }

        /* Bubble menu */
        .sv-bubble {
          position: relative;
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 4px;
          background: var(--bg-2);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.5);
        }
        .sv-bubble-btn {
          padding: 4px 8px;
          font-size: 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          background: transparent;
          color: var(--ink-dim);
        }
        .sv-bubble-btn:hover { background: var(--hover); }
        .sv-bubble-active { background: var(--selection); color: var(--accent-2); }
        .sv-bubble-sep { width: 1px; height: 16px; background: var(--border); margin: 0 3px; }
        .sv-bubble-panel {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          display: flex;
          align-items: center;
          gap: 4px;
          flex-wrap: wrap;
          padding: 6px;
          background: var(--bg-2);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.5);
          z-index: 10001;
        }
        .sv-bubble-input {
          flex: 1;
          background: var(--hover);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 12px;
          color: var(--ink);
          outline: none;
        }

        /* Color swatches + toolbar dropdown */
        .sv-swatch {
          width: 18px;
          height: 18px;
          border-radius: 4px;
          border: 1px solid var(--border);
          cursor: pointer;
          padding: 0;
        }
        .sv-swatch:hover { outline: 2px solid var(--accent); }
        .sv-swatch-reset {
          padding: 3px 8px;
          font-size: 11px;
          border: 1px solid var(--border);
          border-radius: 4px;
          cursor: pointer;
          background: transparent;
          color: var(--ink-dim);
          white-space: nowrap;
        }
        .sv-swatch-reset:hover { background: var(--hover); }
        .sv-toolbar-pop {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          display: flex;
          align-items: center;
          gap: 4px;
          flex-wrap: wrap;
          width: max-content;
          max-width: 220px;
          padding: 6px;
          background: var(--bg-2);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.5);
          z-index: 1000;
        }

        /* Placeholder */
        .sv-editor .is-empty::before {
          content: attr(data-placeholder);
          color: var(--ink-faint);
          pointer-events: none;
          float: left;
          height: 0;
        }
      `}</style>
    </div>
  );
}

function ToolBtn({ active, onClick, label, title, style }: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        padding: '3px 7px',
        fontSize: '11px',
        border: 'none',
        borderRadius: 3,
        cursor: 'pointer',
        background: active ? 'var(--selection)' : 'transparent',
        color: active ? 'var(--accent-2)' : 'var(--ink-dim)',
        fontWeight: active ? 600 : 400,
        ...style,
      }}
    >
      {label}
    </button>
  );
}
