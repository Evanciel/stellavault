// TipTap extension: [[wikilink]] autocomplete.
// Triggers on "[[", queries all note titles via IPC, renders dropdown.

import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import { ipc } from '../../lib/ipc-client.js';

let cachedNotes: string[] = [];
let cacheTime = 0;
const CACHE_TTL = 5000; // 5s cache

async function getNotes(): Promise<string[]> {
  if (Date.now() - cacheTime < CACHE_TTL && cachedNotes.length > 0) return cachedNotes;
  cachedNotes = await ipc('vault:list-notes');
  cacheTime = Date.now();
  return cachedNotes;
}

// Fuzzy filter: matches if all chars of query appear in order in the target
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export interface WikilinkSuggestionOptions {
  onSelect?: (title: string) => void;
}

// Popup renderer — creates/destroys DOM for the dropdown
function createPopup(): {
  element: HTMLDivElement;
  update: (props: SuggestionProps<string>) => void;
  destroy: () => void;
} {
  const el = document.createElement('div');
  el.className = 'sv-wikilink-popup';
  el.style.cssText = `
    position: fixed;
    z-index: 9999;
    background: var(--bg-2, #0f0f18);
    border: 1px solid var(--border, rgba(100,120,255,0.12));
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    max-height: 240px;
    overflow-y: auto;
    min-width: 200px;
    max-width: 360px;
    padding: 4px;
    display: none;
  `;
  document.body.appendChild(el);

  let selectedIndex = 0;
  let items: string[] = [];
  let commandFn: ((props: { id: string }) => void) | null = null;

  function render() {
    el.innerHTML = items.length === 0
      ? `<div style="padding:8px 12px;color:var(--ink-faint,#666);font-size:12px">No matches</div>`
      : items.map((item, i) => `
          <div class="sv-wl-item${i === selectedIndex ? ' sv-wl-active' : ''}" data-index="${i}"
               style="padding:6px 12px;cursor:pointer;font-size:12px;border-radius:4px;
                      color:var(--ink,#e0e0f0);
                      background:${i === selectedIndex ? 'var(--selection, rgba(99,102,241,0.2))' : 'transparent'}">
            ${escapeHtml(item)}
          </div>
        `).join('');

    // Click handlers
    el.querySelectorAll('.sv-wl-item').forEach((row) => {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = parseInt((row as HTMLElement).dataset.index ?? '0', 10);
        if (items[idx] && commandFn) commandFn({ id: items[idx] });
      });
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (el.style.display === 'none') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex] && commandFn) commandFn({ id: items[selectedIndex] });
    } else if (e.key === 'Escape') {
      el.style.display = 'none';
    }
  }

  document.addEventListener('keydown', handleKeyDown, true);

  return {
    element: el,
    update(props) {
      items = props.items;
      selectedIndex = 0;
      commandFn = props.command as (p: { id: string }) => void;

      // Position near the cursor
      const rect = props.clientRect?.();
      if (rect) {
        el.style.left = `${rect.left}px`;
        el.style.top = `${rect.bottom + 4}px`;
      }
      el.style.display = items.length > 0 || props.query.length > 0 ? 'block' : 'none';
      render();
    },
    destroy() {
      document.removeEventListener('keydown', handleKeyDown, true);
      el.remove();
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const WikilinkExtension = Extension.create<WikilinkSuggestionOptions>({
  name: 'wikilink',

  addProseMirrorPlugins() {
    let popup: ReturnType<typeof createPopup> | null = null;

    return [
      Suggestion<string>({
        editor: this.editor,
        char: '[[',
        allowSpaces: true,
        startOfLine: false,

        items: async ({ query }) => {
          const notes = await getNotes();
          if (!query) return notes.slice(0, 20);
          return notes.filter((n) => fuzzyMatch(query, n)).slice(0, 20);
        },

        command: ({ editor, range, props }) => {
          // Replace the [[query with [[Title]]
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(`[[${props.id}]]`)
            .run();
        },

        render: () => ({
          onStart(props) {
            popup = createPopup();
            popup.update(props as SuggestionProps<string>);
          },
          onUpdate(props) {
            popup?.update(props as SuggestionProps<string>);
          },
          onKeyDown(props) {
            if (props.event.key === 'Escape') {
              popup?.element && (popup.element.style.display = 'none');
              return true;
            }
            return false;
          },
          onExit() {
            popup?.destroy();
            popup = null;
          },
        }),
      } as Partial<SuggestionOptions<string>> as any),
    ];
  },
});
