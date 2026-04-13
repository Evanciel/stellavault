// TipTap-based markdown editor.
// For MVP: basic formatting with markdown shortcuts. Wikilinks in Phase 3b.

import { useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';

interface Props {
  content: string;
  onChange: (content: string) => void;
}

export function MarkdownEditor({ content, onChange }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: { HTMLAttributes: { class: 'sv-code-block' } },
      }),
      Placeholder.configure({ placeholder: 'Start writing...' }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content,
    onUpdate: ({ editor: e }) => {
      // Convert ProseMirror to markdown-ish text for storage.
      // For MVP, use the raw text content. Full markdown serialization in v1.0.
      onChange(e.storage.markdown?.getMarkdown() ?? e.getText());
    },
    editorProps: {
      attributes: {
        class: 'sv-editor',
        spellcheck: 'true',
      },
    },
  });

  // Cleanup on unmount
  useEffect(() => () => editor?.destroy(), [editor]);

  if (!editor) return null;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* Minimal toolbar */}
      <div style={{
        display: 'flex',
        gap: 4,
        marginBottom: 16,
        padding: '4px 0',
        borderBottom: '1px solid var(--border)',
      }}>
        <ToolBtn
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          label="B"
          title="Bold (Ctrl+B)"
          style={{ fontWeight: 700 }}
        />
        <ToolBtn
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          label="I"
          title="Italic (Ctrl+I)"
          style={{ fontStyle: 'italic' }}
        />
        <ToolBtn
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
          label="<>"
          title="Code (Ctrl+E)"
          style={{ fontFamily: 'monospace', fontSize: '10px' }}
        />
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        <ToolBtn
          active={editor.isActive('heading', { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          label="H1"
          title="Heading 1"
        />
        <ToolBtn
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          label="H2"
          title="Heading 2"
        />
        <ToolBtn
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          label="H3"
          title="Heading 3"
        />
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        <ToolBtn
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="•"
          title="Bullet list"
        />
        <ToolBtn
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          label="1."
          title="Numbered list"
        />
        <ToolBtn
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          label=">"
          title="Quote"
        />
        <ToolBtn
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          label="{}"
          title="Code block"
          style={{ fontFamily: 'monospace', fontSize: '10px' }}
        />
      </div>

      <EditorContent editor={editor} />

      <style>{`
        .sv-editor {
          outline: none;
          line-height: 1.7;
          font-size: 15px;
          color: var(--ink);
          min-height: 300px;
        }
        .sv-editor h1 { font-size: 28px; font-weight: 700; margin: 24px 0 8px; line-height: 1.2; }
        .sv-editor h2 { font-size: 22px; font-weight: 600; margin: 20px 0 6px; line-height: 1.3; }
        .sv-editor h3 { font-size: 18px; font-weight: 600; margin: 16px 0 4px; line-height: 1.3; }
        .sv-editor p { margin: 0 0 8px; }
        .sv-editor ul, .sv-editor ol { padding-left: 24px; margin: 4px 0 8px; }
        .sv-editor li { margin: 2px 0; }
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
        .sv-editor a { color: var(--accent-2); text-decoration: underline; }
        .sv-editor hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
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
      style={{
        padding: '3px 8px',
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
