// TipTap extension: [[wikilink]] autocomplete.
// Triggers on "[[", queries all note titles via IPC, renders dropdown.

import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import { ipc } from '../../lib/ipc-client.js';
import { useAppStore } from '../../stores/app-store.js';
import type { FileTreeNode } from '../../../shared/ipc-types.js';

let cachedNotes: string[] = [];
let cacheTime = 0;
const CACHE_TTL = 5000; // 5s cache

async function getNotes(): Promise<string[]> {
  if (Date.now() - cacheTime < CACHE_TTL && cachedNotes.length > 0) return cachedNotes;
  cachedNotes = await ipc('vault:list-notes');
  cacheTime = Date.now();
  return cachedNotes;
}

// ─── T2-13: heading suggestions after `#` ([[Note#heading]]) ────────────────

/** Resolve a wikilink note title → vault file path via the file tree (same
 *  basename/path-suffix matching the click-resolver uses, WikilinkNode.ts). */
function findNotePath(nodes: FileTreeNode[], target: string): string | null {
  const wanted = `${target.toLowerCase()}.md`;
  const wantedSuffix = `/${wanted}`;
  for (const node of nodes) {
    if (node.isDir) {
      const hit = node.children ? findNotePath(node.children, target) : null;
      if (hit) return hit;
    } else {
      const name = node.name.toLowerCase();
      const path = node.path.replace(/\\/g, '/').toLowerCase();
      if (name === wanted || path.endsWith(wantedSuffix)) return node.path;
    }
  }
  return null;
}

/** Extract ATX heading texts (`#`..`######`) from raw markdown, skipping
 *  fenced code blocks. Order = document order (so anchors resolve top-down). */
function extractHeadings(md: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push(m[2].trim());
  }
  return out;
}

const headingCache = new Map<string, { time: number; headings: string[] }>();

/** Headings of the note named `noteTitle` (cached 5s per note). */
async function getHeadings(noteTitle: string): Promise<string[]> {
  const key = noteTitle.toLowerCase();
  const cached = headingCache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.headings;
  const path = findNotePath(useAppStore.getState().fileTree, noteTitle);
  if (!path) return [];
  try {
    const content = await ipc('vault:read-file', path);
    const headings = extractHeadings(content);
    headingCache.set(key, { time: Date.now(), headings });
    return headings;
  } catch {
    return [];
  }
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

// NOTE: name must NOT collide with the 'wikilink' NODE (WikilinkNode.ts, W1-9)
// — two extensions sharing a name break the TipTap extension manager.
export const WikilinkExtension = Extension.create<WikilinkSuggestionOptions>({
  name: 'wikilinkSuggestion',

  addProseMirrorPlugins() {
    let popup: ReturnType<typeof createPopup> | null = null;

    return [
      Suggestion<string>({
        editor: this.editor,
        // Distinct key — SlashCommands' Suggestion would otherwise share the
        // default PluginKey('suggestion') and crash ProseMirror at editor init.
        pluginKey: new PluginKey('wikilinkSuggestion'),
        char: '[[',
        allowSpaces: true,
        startOfLine: false,

        items: async ({ query }) => {
          // T2-13: once the query carries a `#`, switch to suggesting the
          // target note's headings — items become `Note#Heading` targets.
          const hashAt = query.indexOf('#');
          if (hashAt !== -1) {
            const note = query.slice(0, hashAt);
            const headingQuery = query.slice(hashAt + 1);
            const headings = await getHeadings(note);
            const matched = headingQuery
              ? headings.filter((h) => fuzzyMatch(headingQuery, h))
              : headings;
            return matched.slice(0, 20).map((h) => `${note}#${h}`);
          }
          const notes = await getNotes();
          if (!query) return notes.slice(0, 20);
          return notes.filter((n) => fuzzyMatch(query, n)).slice(0, 20);
        },

        command: ({ editor, range, props }) => {
          // W1-9: replace the typed "[[query" with a real wikilink NODE
          // (clickable, serialized as [[Title]] / [[Note#Heading]] by
          // WikilinkNode's markdown spec). props.id may carry a `#anchor`.
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({ type: 'wikilink', attrs: { target: props.id, alias: null } })
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
