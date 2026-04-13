// TipTap-based markdown editor — full-featured with 15+ extensions.
// Supports: tables, task lists, code highlighting, images, math (future),
// underline, highlight, superscript/subscript, text alignment, typography.

import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import TextAlign from '@tiptap/extension-text-align';
import Typography from '@tiptap/extension-typography';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { WikilinkExtension } from './WikilinkSuggestion.js';

const lowlight = createLowlight(common);

interface Props {
  content: string;
  onChange: (content: string) => void;
}

export function MarkdownEditor({ content, onChange }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false, // Replaced by CodeBlockLowlight
      }),
      CodeBlockLowlight.configure({ lowlight, HTMLAttributes: { class: 'sv-code-block' } }),
      Placeholder.configure({ placeholder: 'Start writing... (type / for commands)' }),
      Link.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Underline,
      Superscript,
      Subscript,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Typography,
      Image.configure({ inline: false, allowBase64: true }),
      WikilinkExtension,
    ],
    content,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
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

  if (!editor) return null;

  const Sep = () => <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />;

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
        <ToolBtn active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()} label="H" title="Highlight" style={{ background: '#fbbf2440', padding: '3px 7px' }} />

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
        <ToolBtn active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} label="{}" title="Code block" style={{ fontFamily: 'monospace', fontSize: '10px' }} />
        <ToolBtn active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()} label="—" title="Horizontal rule" />

        <Sep />

        {/* Table */}
        <ToolBtn active={false} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} label="⊞" title="Insert table" />

        {editor.isActive('table') && (
          <>
            <ToolBtn active={false} onClick={() => editor.chain().focus().addColumnAfter().run()} label="+Col" title="Add column" />
            <ToolBtn active={false} onClick={() => editor.chain().focus().addRowAfter().run()} label="+Row" title="Add row" />
            <ToolBtn active={false} onClick={() => editor.chain().focus().deleteTable().run()} label="×T" title="Delete table" style={{ color: '#ef4444' }} />
          </>
        )}

        <Sep />

        {/* Alignment */}
        <ToolBtn active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} label="≡L" title="Align left" />
        <ToolBtn active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} label="≡C" title="Align center" />
        <ToolBtn active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} label="≡R" title="Align right" />

        <Sep />

        {/* Image */}
        <ToolBtn active={false} onClick={() => {
          const url = window.prompt('Image URL:');
          if (url) editor.chain().focus().setImage({ src: url }).run();
        }} label="🖼" title="Insert image (URL or paste/drop)" />

        {/* Super/subscript */}
        <ToolBtn active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} label="x²" title="Superscript" style={{ fontSize: '10px' }} />
        <ToolBtn active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} label="x₂" title="Subscript" style={{ fontSize: '10px' }} />
      </div>

      <EditorContent editor={editor} />

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
