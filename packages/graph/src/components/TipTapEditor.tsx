// TipTap WYSIWYG Editor — Level 3 본문 에디터
// 마크다운 ↔ WYSIWYG 전환, 실시간 편집, vault 저장

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { useCallback, useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

interface TipTapEditorProps {
  content: string;        // markdown 원문
  isDark: boolean;
  onSave?: (markdown: string) => void;
  editable?: boolean;
  onWikilinkClick?: (target: string) => void;
}

/** 간단한 markdown → HTML 변환 (TipTap이 이해하는 수준) */
function markdownToHtml(md: string): string {
  const result = md
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
    // youtube embeds
    .replace(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)(?:\S*)/g,
      '<div class="sv-youtube" data-id="$1"><iframe src="https://www.youtube.com/embed/$1" frameborder="0" allowfullscreen></iframe></div>')
    // images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
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
  return DOMPurify.sanitize(result, { ADD_TAGS: ['iframe'], ADD_ATTR: ['allowfullscreen', 'frameborder', 'data-id', 'data-type', 'data-checked'] });
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
    .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/g, '![$2]($1)')
    .replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/g, '![]($1)')
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
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const imageFileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: 'sv-code-block' } },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'sv-link' },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: 'sv-image' },
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
        event.stopPropagation();
        if (href.startsWith('wikilink:')) {
          onWikilinkClick?.(decodeURIComponent(href.replace('wikilink:', '')));
        } else {
          window.open(href, '_blank', 'noopener,noreferrer');
        }
        return true;
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        const file = files[0];
        if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) return false;
        event.preventDefault();
        const reader = new FileReader();
        reader.onload = () => {
          const src = reader.result as string;
          view.dispatch(view.state.tr.replaceSelectionWith(
            view.state.schema.nodes.image.create({ src })
          ));
        };
        reader.readAsDataURL(file);
        return true;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;
            const reader = new FileReader();
            reader.onload = () => {
              const src = reader.result as string;
              view.dispatch(view.state.tr.replaceSelectionWith(
                view.state.schema.nodes.image.create({ src })
              ));
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
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
            { cmd: () => setShowImageInput(!showImageInput), label: '🖼', active: showImageInput, style: { fontSize: '12px' } as React.CSSProperties },
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

      {/* 이미지 삽입 패널 */}
      {showImageInput && (
        <div style={{
          display: 'flex', gap: '6px', padding: '6px 8px', marginBottom: '8px',
          background: isDark ? 'rgba(100,120,255,0.05)' : 'rgba(0,0,0,0.02)',
          border: `1px solid ${isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.06)'}`,
          borderRadius: '6px', alignItems: 'center',
        }}>
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="Image URL..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && imageUrl) {
                editor.chain().focus().setImage({ src: imageUrl }).run();
                setImageUrl(''); setShowImageInput(false);
              }
            }}
            style={{
              flex: 1, padding: '4px 8px', background: 'transparent',
              border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
              borderRadius: '4px', color: isDark ? '#c8c8e0' : '#333',
              fontSize: '11px', outline: 'none',
            }}
          />
          <button
            onClick={() => {
              if (imageUrl && /^https?:\/\//.test(imageUrl)) { editor.chain().focus().setImage({ src: imageUrl }).run(); setImageUrl(''); setShowImageInput(false); }
            }}
            style={{ padding: '3px 10px', background: isDark ? '#6366f1' : '#e0e7ff', border: 'none', borderRadius: '4px', color: isDark ? '#fff' : '#6366f1', fontSize: '11px', cursor: 'pointer' }}
          >
            Insert
          </button>
          <button
            onClick={() => imageFileRef.current?.click()}
            style={{ padding: '3px 8px', background: 'transparent', border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.1)'}`, borderRadius: '4px', color: isDark ? '#aab' : '#666', fontSize: '11px', cursor: 'pointer' }}
          >
            File
          </button>
          <input
            ref={imageFileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                editor.chain().focus().setImage({ src: reader.result as string }).run();
                setShowImageInput(false);
              };
              reader.readAsDataURL(file);
              e.target.value = '';
            }}
          />
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
        .sv-tiptap-editor .sv-youtube {
          position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;
          margin: 12px 0; border-radius: 10px;
          border: 1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.1)'};
        }
        .sv-tiptap-editor .sv-youtube iframe {
          position: absolute; top: 0; left: 0; width: 100%; height: 100%;
          border-radius: 10px;
        }
        .sv-tiptap-editor img, .sv-tiptap-editor .sv-image {
          max-width: 100%; height: auto; border-radius: 8px;
          margin: 8px 0; display: block;
          border: 1px solid ${isDark ? 'rgba(100,120,255,0.1)' : 'rgba(0,0,0,0.08)'};
        }
        .sv-tiptap-editor img:hover {
          border-color: ${isDark ? '#6366f1' : '#6366f1'};
          box-shadow: 0 2px 12px rgba(99,102,241,0.15);
        }
        .sv-tiptap-editor .ProseMirror-focused { outline: none; }
        .sv-tiptap-editor .is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left; color: ${isDark ? '#556' : '#bbb'}; pointer-events: none; height: 0;
        }
      `}</style>
    </div>
  );
}
