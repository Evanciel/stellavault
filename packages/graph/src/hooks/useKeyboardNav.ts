// Keyboard-Only Graph Navigation (F-A18)
// Tab: cycle nodes, Arrow keys: traverse connections, Enter: select, Esc: deselect

import { useEffect, useCallback } from 'react';
import { useGraphStore } from '../stores/graph-store.js';

export function useKeyboardNav() {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't interfere with input fields
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const state = useGraphStore.getState();
    const { nodes, edges, selectedNodeId, selectNode, hoverNode } = state;
    if (nodes.length === 0) return;

    switch (e.key) {
      case 'Tab': {
        e.preventDefault();
        // Cycle through nodes
        const currentIdx = selectedNodeId
          ? nodes.findIndex(n => n.id === selectedNodeId)
          : -1;
        const nextIdx = e.shiftKey
          ? (currentIdx <= 0 ? nodes.length - 1 : currentIdx - 1)
          : (currentIdx + 1) % nodes.length;
        selectNode(nodes[nextIdx].id);
        focusNode(nodes[nextIdx].id);
        break;
      }

      case 'ArrowRight':
      case 'ArrowDown': {
        e.preventDefault();
        if (!selectedNodeId) { selectNode(nodes[0].id); focusNode(nodes[0].id); break; }
        // Navigate to next connected node
        const neighbors = getNeighbors(selectedNodeId, edges);
        if (neighbors.length > 0) {
          const currentNeighborIdx = neighbors.indexOf(selectedNodeId);
          const nextNeighbor = neighbors[(currentNeighborIdx + 1) % neighbors.length];
          selectNode(nextNeighbor);
          focusNode(nextNeighbor);
        }
        break;
      }

      case 'ArrowLeft':
      case 'ArrowUp': {
        e.preventDefault();
        if (!selectedNodeId) break;
        const neighbors = getNeighbors(selectedNodeId, edges);
        if (neighbors.length > 0) {
          const currentNeighborIdx = neighbors.indexOf(selectedNodeId);
          const prevNeighbor = neighbors[(currentNeighborIdx - 1 + neighbors.length) % neighbors.length];
          selectNode(prevNeighbor);
          focusNode(prevNeighbor);
        }
        break;
      }

      case 'Enter': {
        if (selectedNodeId) {
          // Trigger node detail view (already handled by selectNode)
          hoverNode(null);
        }
        break;
      }

      case 'Escape': {
        selectNode(null);
        hoverNode(null);
        (window as any).__sv_resetCamera?.();
        break;
      }

      case '/': {
        e.preventDefault();
        // Focus search bar
        const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
        searchInput?.focus();
        break;
      }

      case '?': {
        if (!e.shiftKey) break;
        // Show keyboard shortcuts help
        console.log('Keyboard shortcuts: Tab=cycle, Arrow=traverse, Enter=select, Esc=reset, /=search');
        break;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

function getNeighbors(nodeId: string, edges: Array<{ source: string; target: string }>): string[] {
  const neighbors = new Set<string>();
  for (const e of edges) {
    if (e.source === nodeId) neighbors.add(e.target);
    if (e.target === nodeId) neighbors.add(e.source);
  }
  return [...neighbors];
}

function focusNode(nodeId: string) {
  // Trigger camera focus via the same mechanism as search
  const state = useGraphStore.getState();
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node?.position) return;

  const controls = (window as any).__sv_controls?.current;
  if (!controls) return;

  const THREE = (window as any).__THREE__;
  if (!THREE) return;

  const target = new THREE.Vector3(...node.position);
  controls.target.copy(target);
  controls.update();
}
