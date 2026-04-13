// Slash commands — type "/" to insert blocks (Notion-style).
// Uses TipTap Suggestion, same pattern as WikilinkSuggestion.

import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type { Editor } from '@tiptap/core';

interface SlashCommand {
  id: string;
  label: string;
  icon: string;
  description: string;
  action: (editor: Editor) => void;
}

const COMMANDS: SlashCommand[] = [
  {
    id: 'heading1', label: 'Heading 1', icon: 'H1', description: 'Large heading',
    action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'heading2', label: 'Heading 2', icon: 'H2', description: 'Medium heading',
    action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'heading3', label: 'Heading 3', icon: 'H3', description: 'Small heading',
    action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet', label: 'Bullet list', icon: '•', description: 'Unordered list',
    action: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'numbered', label: 'Numbered list', icon: '1.', description: 'Ordered list',
    action: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'task', label: 'Task list', icon: '☑', description: 'Checklist with checkboxes',
    action: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote', label: 'Quote', icon: '❝', description: 'Block quote',
    action: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code', label: 'Code block', icon: '{}', description: 'Syntax-highlighted code',
    action: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'table', label: 'Table', icon: '⊞', description: '3×3 table with header',
    action: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'hr', label: 'Divider', icon: '—', description: 'Horizontal rule',
    action: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'image', label: 'Image', icon: '🖼', description: 'Insert image from URL',
    action: (e) => {
      const url = window.prompt('Image URL:');
      if (url) e.chain().focus().setImage({ src: url }).run();
    },
  },
  {
    id: 'callout', label: 'Callout', icon: '💡', description: 'Highlighted callout block',
    action: (e) => {
      e.chain().focus().toggleBlockquote().run();
      // Insert a bold prefix for callout style
      e.chain().focus().insertContent('💡 **Note:** ').run();
    },
  },
];

function createPopup(): {
  element: HTMLDivElement;
  update: (props: any) => void;
  destroy: () => void;
} {
  const el = document.createElement('div');
  el.className = 'sv-slash-popup';
  el.style.cssText = `
    position:fixed; z-index:9999;
    background:var(--bg-2,#0f0f18);
    border:1px solid var(--border,rgba(100,120,255,0.12));
    border-radius:8px;
    box-shadow:0 8px 28px rgba(0,0,0,0.5);
    max-height:320px; overflow-y:auto;
    width:260px; padding:4px;
    display:none;
  `;
  document.body.appendChild(el);

  let selectedIndex = 0;
  let items: SlashCommand[] = [];
  let commandFn: ((props: { id: string }) => void) | null = null;

  function render() {
    el.innerHTML = items.length === 0
      ? `<div style="padding:12px;color:var(--ink-faint);font-size:12px">No matching commands</div>`
      : items.map((item, i) => `
          <div class="sv-slash-item${i === selectedIndex ? ' sv-slash-active' : ''}" data-index="${i}"
               style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:10px;
                      border-radius:5px;
                      background:${i === selectedIndex ? 'var(--selection,rgba(99,102,241,0.2))' : 'transparent'}">
            <span style="width:24px;text-align:center;font-size:14px;color:var(--accent-2,#818cf8);flex-shrink:0">${item.icon}</span>
            <div>
              <div style="font-size:12px;color:var(--ink,#e0e0f0);font-weight:500">${item.label}</div>
              <div style="font-size:10px;color:var(--ink-faint,#4a4a60);margin-top:1px">${item.description}</div>
            </div>
          </div>
        `).join('');

    el.querySelectorAll('.sv-slash-item').forEach((row) => {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = parseInt((row as HTMLElement).dataset.index ?? '0', 10);
        if (items[idx] && commandFn) commandFn({ id: items[idx].id });
      });
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (el.style.display === 'none') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = Math.min(selectedIndex + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = Math.max(selectedIndex - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[selectedIndex] && commandFn) commandFn({ id: items[selectedIndex].id }); }
    else if (e.key === 'Escape') { el.style.display = 'none'; }
  }

  document.addEventListener('keydown', handleKeyDown, true);

  return {
    element: el,
    update(props: any) {
      items = props.items;
      selectedIndex = 0;
      commandFn = props.command;
      const rect = props.clientRect?.();
      if (rect) { el.style.left = `${rect.left}px`; el.style.top = `${rect.bottom + 4}px`; }
      el.style.display = items.length > 0 || props.query?.length > 0 ? 'block' : 'none';
      render();
    },
    destroy() {
      document.removeEventListener('keydown', handleKeyDown, true);
      el.remove();
    },
  };
}

export const SlashCommandExtension = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    let popup: ReturnType<typeof createPopup> | null = null;

    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: true,
        allowSpaces: false,

        items: ({ query }: { query: string }) => {
          if (!query) return COMMANDS;
          const q = query.toLowerCase();
          return COMMANDS.filter((c) =>
            c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
          );
        },

        command: ({ editor, range, props }: any) => {
          const cmd = COMMANDS.find((c) => c.id === props.id);
          if (!cmd) return;
          // Delete the /query text first
          editor.chain().focus().deleteRange(range).run();
          // Then execute the command
          cmd.action(editor);
        },

        render: () => ({
          onStart(props: any) { popup = createPopup(); popup.update(props); },
          onUpdate(props: any) { popup?.update(props); },
          onKeyDown(props: any) {
            if (props.event.key === 'Escape') { popup?.element && (popup.element.style.display = 'none'); return true; }
            return false;
          },
          onExit() { popup?.destroy(); popup = null; },
        }),
      } as any),
    ];
  },
});
