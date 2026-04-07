// TipTap WYSIWYG Editor — Level 3 본문 에디터
// 마크다운 ↔ WYSIWYG 전환, 실시간 편집, vault 저장

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { useCallback, useEffect, useRef } from 'react';

interface TipTapEditorProps {
  content: string;        // markdown 원문
  isDark: boolean;
  onSave?: (markdown: string) => void;
  editable?: boolean;
  onWikilinkClick?: (target: string) => void;
}

/** 간단한 markdown → HTML 변환 (TipTap이 이해하는 수준) */
function markdownToHtml(md: string): string {
  return md
    // frontmatter 제거
    .replace(/^---[\s\S]*?---\n?/, '')
    // wikilinks → 일반 링크
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, display) =>
      `<a href="wikilink:${encodeURIComponent(target)}" class="wikilink">${display ?? target}</a>`)
    // headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // bold, italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // lists
    .replace(/^- \[x\] (.+)$/gm, '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">$1</li></ul>')
    .replace(/^- \[ \] (.+)$/gm, '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">$1</li></ul>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    // hr
    .replace(/^---$/gm, '<hr>')
    // paragraphs (lines that aren't already wrapped)
    .replace(/^(?!<[a-z])((?!^\s*$).+)$/gm, '<p>$1</p>')
    // cleanup empty paragraphs
    .replace(/<p>\s*<\/p>/g, '');
}

/** HTML → 간단한 markdown 변환 */
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1>(.*?)<\/h1>/g, '# $1\n')
    .replace(/<h2>(.*?)<\/h2>/g, '## $1\n')
    .replace(/<h3>(.*?)<\/h3>/g, '### $1\n')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, '```\n$1```\n')
    .replace(/<blockquote>(.*?)<\/blockquote>/g, '> $1\n')
    .replace(/<a[^>]*href="wikilink:([^"]*)"[^>]*>(.*?)<\/a>/g, (_, target, display) =>
      `[[${decodeURIComponent(target)}|${display}]]`)
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g, '[$2]($1)')
    .replace(/<li data-type="taskItem" data-checked="true">(.*?)<\/li>/g, '- [x] $1')
    .replace(/<li data-type="taskItem" data-checked="false">(.*?)<\/li>/g, '- [ ] $1')
    .replace(/<li>(.*?)<\/li>/g, '- $1')
    .replace(/<ul[^>]*>|<\/ul>/g, '')
    .replace(/<hr\s*\/?>/g, '---\n')
    .replace(/<p>(.*?)<\/p>/g, '$1\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '') // strip remaining tags
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function TipTapEditor({ content, isDark, onSave, editable = true, onWikilinkClick }: TipTapEditorProps) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: 'sv-code-block' } },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'sv-link' },
      }),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: markdownToHtml(content),
    editable,
    editorProps: {
      attributes: {
        class: 'sv-tiptap-editor',
        style: [
          `color: ${isDark ? '#c8c8e0' : '#333'}`,
          'font-size: 14px',
          'line-height: 1.7',
          'outline: none',
          'min-height: 200px',
          'padding: 4px 0',
        ].join(';'),
      },
      handleClick: (view, pos, event) => {
        const target = event.target as HTMLElement;
        const link = target.closest('a');
        if (!link) return false;

        const href = link.getAttribute('href');
        if (!href) return false;

        event.preventDefault();
        if (href.startsWith('wikilink:')) {
          onWikilinkClick?.(decodeURIComponent(href.replace('wikilink:', '')));
        } else {
          window.open(href, '_blank', 'noopener,noreferrer');
        }
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      if (!onSave) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const md = htmlToMarkdown(e.getHTML());
        onSave(md);
      }, 1500); // auto-save 1.5초 debounce
    },
  });

  // content 변경 시 에디터 업데이트
  useEffect(() => {
    if (editor && !editor.isFocused) {
      editor.commands.setContent(markdownToHtml(content));
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div>
      {/* 포맷팅 툴바 */}
      {editable && (
        <div style={{
          display: 'flex', gap: '2px', padding: '4px 6px', marginBottom: '8px',
          background: isDark ? 'rgba(100,120,255,0.05)' : 'rgba(0,0,0,0.02)',
          border: `1px solid ${isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.06)'}`,
          borderRadius: '6px',
        }}>
          {[
            { cmd: () => editor.chain().focus().toggleBold().run(), label: 'B', active: editor.isActive('bold'), style: { fontWeight: 700 } as React.CSSProperties },
            { cmd: () => editor.chain().focus().toggleItalic().run(), label: 'I', active: editor.isActive('italic'), style: { fontStyle: 'italic' } as React.CSSProperties },
            { cmd: () => editor.chain().focus().toggleCode().run(), label: '<>', active: editor.isActive('code'), style: { fontFamily: 'monospace', fontSize: '11px' } as React.CSSProperties },
            { cmd: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), label: 'H2', active: editor.isActive('heading', { level: 2 }), style: { fontSize: '11px', fontWeight: 700 } as React.CSSProperties },
            { cmd: () => editor.chain().focus().toggleBlockquote().run(), label: '"', active: editor.isActive('blockquote'), style: { fontSize: '14px' } as React.CSSProperties },
            { cmd: () => editor.chain().focus().toggleBulletList().run(), label: '•', active: editor.isActive('bulletList'), style: {} as React.CSSProperties },
            { cmd: () => editor.chain().focus().toggleCodeBlock().run(), label: '{}', active: editor.isActive('codeBlock'), style: { fontFamily: 'monospace', fontSize: '11px' } as React.CSSProperties },
          ].map((btn, i) => (
            <button
              key={i}
              onClick={btn.cmd}
              style={{
                padding: '3px 7px', border: 'none', borderRadius: '4px', cursor: 'pointer',
                background: btn.active ? (isDark ? '#6366f1' : '#e0e7ff') : 'transparent',
                color: btn.active ? '#fff' : (isDark ? '#aab' : '#555'),
                fontSize: '12px',
                ...btn.style,
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}

      <EditorContent editor={editor} />

      <style>{`
        .sv-tiptap-editor h1 { font-size: 22px; font-weight: 700; margin: 16px 0 8px; }
        .sv-tiptap-editor h2 { font-size: 18px; font-weight: 600; margin: 14px 0 6px; }
        .sv-tiptap-editor h3 { font-size: 15px; font-weight: 600; margin: 12px 0 4px; }
        .sv-tiptap-editor p { margin: 6px 0; }
        .sv-tiptap-editor ul, .sv-tiptap-editor ol { padding-left: 20px; margin: 4px 0; }
        .sv-tiptap-editor li { margin: 2px 0; }
        .sv-tiptap-editor blockquote {
          border-left: 3px solid ${isDark ? '#6366f1' : '#6366f1'};
          padding: 2px 12px; margin: 8px 0;
          color: ${isDark ? '#9898b8' : '#666'};
        }
        .sv-tiptap-editor pre {
          background: ${isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)'};
          padding: 12px 16px; border-radius: 8px; overflow: auto;
          font-family: 'DM Mono', monospace; font-size: 12px;
          border: 1px solid ${isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.08)'};
        }
        .sv-tiptap-editor code {
          background: ${isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.06)'};
          padding: 2px 5px; border-radius: 3px;
          font-family: 'DM Mono', monospace; font-size: 12px;
          color: ${isDark ? '#c0c0f0' : '#6366f1'};
        }
        .sv-tiptap-editor pre code { background: none; padding: 0; color: inherit; }
        .sv-tiptap-editor a, .sv-tiptap-editor .sv-link {
          color: ${isDark ? '#22d3ee' : '#0891b2'};
          text-decoration: none; cursor: pointer;
          border-bottom: 1px solid ${isDark ? '#22d3ee40' : '#0891b240'};
        }
        .sv-tiptap-editor .wikilink {
          color: ${isDark ? '#818cf8' : '#6366f1'} !important;
          border-bottom: 1px dashed ${isDark ? '#818cf880' : '#6366f180'} !important;
        }
        .sv-tiptap-editor hr {
          border: none; height: 1px; margin: 16px 0;
          background: ${isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.08)'};
        }
        .sv-tiptap-editor ul[data-type="taskList"] { list-style: none; padding-left: 4px; }
        .sv-tiptap-editor ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 6px; }
        .sv-tiptap-editor ul[data-type="taskList"] li label { cursor: pointer; }
        .sv-tiptap-editor .ProseMirror-focused { outline: none; }
        .sv-tiptap-editor .is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left; color: ${isDark ? '#556' : '#bbb'}; pointer-events: none; height: 0;
        }
      `}</style>
    </div>
  );
}
