// Custom hook: data fetching, caching, edit state, save/delete logic for NodeDetail

import { useEffect, useState, useRef, useCallback } from 'react';
import { fetchDocument } from '../api/client.js';
import { useGraphStore } from '../stores/graph-store.js';

export interface DocData {
  id: string;
  title: string;
  filePath: string;
  content: string;
  tags: string[];
  lastModified: string;
  related: Array<{ id: string; title: string; score: number }>;
}

export type SaveStatus = '' | 'saving' | 'saved' | 'error';

export function useNodeDetail() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const theme = useGraphStore((s) => s.theme);
  const isDark = theme === 'dark';

  const [doc, setDoc] = useState<DocData | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Map<string, DocData>>(new Map());
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('');

  // Fetch document when selected node changes
  useEffect(() => {
    if (!selectedNodeId) { setDoc(null); return; }

    const cached = cacheRef.current.get(selectedNodeId);
    if (cached) { setDoc(cached); return; }

    let cancelled = false;
    setLoading(true);
    fetchDocument(selectedNodeId)
      .then((data: DocData) => {
        if (!cancelled) { setDoc(data); cacheRef.current.set(selectedNodeId, data); }
      })
      .catch(() => { if (!cancelled) setDoc(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedNodeId]);

  // Toggle edit mode on/off
  const toggleEdit = useCallback(() => {
    if (editing) {
      setEditing(false);
    } else if (doc) {
      setEditTitle(doc.title);
      setEditContent(doc.content);
      setEditTags(doc.tags.join(', '));
      setEditing(true);
    }
  }, [editing, doc]);

  // Pulse the selected node in the graph
  const pulseNode = useCallback(() => {
    if (doc) {
      setTimeout(() => (window as Window & { __sv_pulse?: (id: string) => void }).__sv_pulse?.(doc.id), 100);
    }
  }, [doc]);

  // Open the document in Obsidian
  const openInObsidian = useCallback(async () => {
    if (!doc) return;
    const relFile = (doc.filePath ?? doc.title).replace(/\\/g, '/').replace(/\.md$/, '');
    let vault = 'Evan';
    try {
      const res = await fetch('http://127.0.0.1:3333/api/stats');
      const stats = await res.json();
      if (stats.vaultName) vault = stats.vaultName;
    } catch { /* fallback to default vault name */ }
    const uri = `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(relFile)}`;
    window.location.href = uri;
  }, [doc]);

  // Save edited document
  const saveEdit = useCallback(async () => {
    if (!doc) return;
    setSaveStatus('saving');
    try {
      const resp = await fetch(`/api/document/${doc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          content: editContent,
          tags: editTags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setSaveStatus('saved');
        // Update cache
        const updated: DocData = {
          ...doc,
          title: editTitle,
          content: editContent,
          tags: editTags.split(',').map(t => t.trim()).filter(Boolean),
        };
        setDoc(updated);
        cacheRef.current.set(doc.id, updated);
        setTimeout(() => { setEditing(false); setSaveStatus(''); }, 1000);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    }
  }, [doc, editTitle, editContent, editTags]);

  // Delete the document
  const deleteDoc = useCallback(async () => {
    if (!doc) return;
    try {
      const resp = await fetch(`/api/document/${doc.id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        cacheRef.current.delete(doc.id);
        selectNode(null);
        // Refresh graph
        const graphResp = await fetch('/api/graph/refresh?mode=semantic');
        const graphData = await graphResp.json();
        if (graphData.data?.nodes) {
          useGraphStore.getState().setGraphData(graphData.data.nodes, graphData.data.edges, graphData.data.clusters);
        }
      }
    } catch { /* delete failed silently */ }
  }, [doc, selectNode]);

  return {
    selectedNodeId,
    selectNode,
    isDark,
    doc,
    loading,
    editing,
    editTitle,
    setEditTitle,
    editContent,
    setEditContent,
    editTags,
    setEditTags,
    saveStatus,
    toggleEdit,
    pulseNode,
    openInObsidian,
    saveEdit,
    deleteDoc,
  };
}
