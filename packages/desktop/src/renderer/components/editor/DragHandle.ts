// TipTap extension: Notion-style block drag handle (T3-11).
// Design Ref: desktop-upgrade-proposal-v2.md §T3-11 — "Drag-drop block reorder".
// No compatible v2 `GlobalDragHandle` package is installed in this tree, so this
// is a self-contained ProseMirror plugin with a gutter handle (the assignment's
// stated fallback).
//
// HOW IT WORKS
//   • A single floating handle (⠿) is positioned in the left gutter, tracking
//     whichever TOP-LEVEL block the pointer is over (mousemove over the editor).
//   • Pressing the handle starts a native HTML5 drag carrying the block's
//     document position. ProseMirror's own drop machinery is NOT used; instead
//     we compute the drop target from the cursor and move the node with a single
//     transaction (delete-then-insert), which keeps markdown serialization
//     intact (we move whole nodes — never split them).
//
// MARKDOWN SAFETY
//   Reordering operates on COMPLETE top-level nodes only. Because each node is
//   removed and re-inserted whole (no partial-node edits, no mark surgery), the
//   tiptap-markdown serializer sees the same node set in a new order → the .md
//   output is just the blocks in the new sequence. Verified shape in
//   tests/md-roundtrip.mjs (drag-handle static wiring) + manual smoke.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const HANDLE_KEY = new PluginKey('svDragHandle');

// Drag payload MIME — distinct from text/plain so external drops are unaffected.
const SV_DRAG_MIME = 'application/x-stellavault-block';

interface HandleState {
  // doc position (the `before` pos) of the top-level node the handle targets.
  targetPos: number | null;
}

/** Resolve the depth-1 (top-level) node + its start position for a given coord. */
function topLevelNodeAt(view: EditorView, clientX: number, clientY: number):
  { pos: number; nodeSize: number } | null {
  const coords = { left: clientX, top: clientY };
  const found = view.posAtCoords(coords);
  if (!found) return null;
  const $pos = view.state.doc.resolve(found.pos);
  // depth 0 = doc; depth 1 = a top-level block. Clamp to depth 1.
  if ($pos.depth === 0) {
    // Cursor between blocks — use nodeAfter at the doc level.
    const after = $pos.nodeAfter;
    if (!after) return null;
    return { pos: found.pos, nodeSize: after.nodeSize };
  }
  const pos = $pos.before(1);
  const node = view.state.doc.nodeAt(pos);
  if (!node) return null;
  return { pos, nodeSize: node.nodeSize };
}

export const DragHandleExtension = Extension.create({
  name: 'svDragHandle',

  addProseMirrorPlugins() {
    let handle: HTMLElement | null = null;
    let editorView: EditorView | null = null;

    const setHandlePosition = (view: EditorView, pos: number): void => {
      if (!handle) return;
      const node = view.state.doc.nodeAt(pos);
      if (!node) { handle.style.display = 'none'; return; }
      const dom = view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement)) { handle.style.display = 'none'; return; }
      const editorRect = view.dom.getBoundingClientRect();
      const blockRect = dom.getBoundingClientRect();
      handle.style.display = 'flex';
      // Position in the gutter, vertically aligned to the block's first line.
      handle.style.top = `${blockRect.top - editorRect.top + view.dom.scrollTop}px`;
      handle.style.left = `-22px`;
    };

    return [
      new Plugin<HandleState>({
        key: HANDLE_KEY,
        state: {
          init: () => ({ targetPos: null }),
          apply: (tr, value) => {
            const meta = tr.getMeta(HANDLE_KEY) as HandleState | undefined;
            if (meta) return meta;
            // Keep the target valid across doc changes by mapping the position.
            if (value.targetPos !== null && tr.docChanged) {
              return { targetPos: tr.mapping.map(value.targetPos) };
            }
            return value;
          },
        },
        view: (view) => {
          editorView = view;
          // Build the floating handle once and park it in the editor wrapper.
          handle = document.createElement('div');
          handle.className = 'sv-drag-handle';
          handle.setAttribute('contenteditable', 'false');
          handle.setAttribute('draggable', 'true');
          handle.setAttribute('title', 'Drag to move block');
          handle.setAttribute('aria-label', 'Drag to move block');
          handle.textContent = '⠿';
          handle.style.display = 'none';

          const parent = view.dom.parentElement;
          if (parent) {
            // Ensure the gutter has room + a positioning context.
            parent.style.position = parent.style.position || 'relative';
            parent.appendChild(handle);
          }

          // Clicking the handle selects the whole block (Notion parity).
          handle.addEventListener('click', () => {
            const { targetPos } = HANDLE_KEY.getState(view.state) as HandleState;
            if (targetPos === null) return;
            const node = view.state.doc.nodeAt(targetPos);
            if (!node) return;
            const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, targetPos));
            view.dispatch(tr);
            view.focus();
          });

          handle.addEventListener('dragstart', (event) => {
            const { targetPos } = HANDLE_KEY.getState(view.state) as HandleState;
            if (targetPos === null || !event.dataTransfer) return;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(SV_DRAG_MIME, String(targetPos));
            // Also set text/plain so the OS shows a drag image; harmless content.
            const node = view.state.doc.nodeAt(targetPos);
            event.dataTransfer.setData('text/plain', node?.textContent ?? '');
            view.dom.classList.add('sv-dragging-block');
          });

          handle.addEventListener('dragend', () => {
            view.dom.classList.remove('sv-dragging-block');
          });

          return {
            destroy() {
              handle?.remove();
              handle = null;
              editorView = null;
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove: (view, event) => {
              if (!view.editable) return false;
              const hit = topLevelNodeAt(view, event.clientX, event.clientY);
              const current = (HANDLE_KEY.getState(view.state) as HandleState).targetPos;
              const next = hit ? hit.pos : null;
              if (next !== current) {
                view.dispatch(view.state.tr.setMeta(HANDLE_KEY, { targetPos: next }));
              }
              if (next !== null) setHandlePosition(view, next);
              else if (handle) handle.style.display = 'none';
              return false;
            },
            // The editor surface is the drop zone for handle-initiated drags.
            dragover: (view, event) => {
              if (event.dataTransfer?.types.includes(SV_DRAG_MIME)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                return true;
              }
              return false;
            },
            drop: (view, event) => {
              const dt = event.dataTransfer;
              if (!dt || !dt.types.includes(SV_DRAG_MIME)) return false;
              event.preventDefault();
              const fromPos = Number(dt.getData(SV_DRAG_MIME));
              if (!Number.isFinite(fromPos)) return true;
              const fromNode = view.state.doc.nodeAt(fromPos);
              if (!fromNode) return true;

              // Find the top-level block under the cursor = the drop anchor.
              const target = topLevelNodeAt(view, event.clientX, event.clientY);
              if (!target || target.pos === fromPos) return true;

              // Decide insert-before vs insert-after by cursor position within
              // the target block's vertical extent.
              const targetDom = view.nodeDOM(target.pos);
              let insertAfter = false;
              if (targetDom instanceof HTMLElement) {
                const r = targetDom.getBoundingClientRect();
                insertAfter = event.clientY > r.top + r.height / 2;
              }

              const fromEnd = fromPos + fromNode.nodeSize;
              let insertPos = insertAfter ? target.pos + target.nodeSize : target.pos;

              // Build the move as delete-then-insert. Account for the index shift
              // when the source is BEFORE the insert point.
              let tr = view.state.tr;
              const slice = fromNode;
              tr = tr.delete(fromPos, fromEnd);
              if (insertPos > fromPos) insertPos -= fromNode.nodeSize;
              tr = tr.insert(insertPos, slice);
              view.dispatch(tr.scrollIntoView());
              view.dom.classList.remove('sv-dragging-block');
              return true;
            },
          },
        },
      }),
    ];
  },
});
