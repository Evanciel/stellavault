// Tags Panel (Stage C, plan W1-6) — all vault tags with counts as a nested
// `a/b` tree (via 'tags:list' IPC). Clicking a tag hands `tag:x` off to the
// SearchPanel through the app-store's openSearchWithQuery (zustand field —
// chosen over a CustomEvent so the hand-off works even when SearchPanel
// is not yet mounted; it consumes pendingSearchQuery on mount).

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { tagsList, type TagCount } from '../../lib/ipc-client.js';

interface TagNode {
  name: string;       // segment name, e.g. 'b' for tag 'a/b'
  fullTag: string;    // full tag path, e.g. 'a/b'
  count: number;      // direct count for this exact tag (0 if only a parent segment)
  children: TagNode[];
}

function buildTagTree(tags: TagCount[]): TagNode[] {
  const roots: TagNode[] = [];

  const getOrCreate = (list: TagNode[], name: string, fullTag: string): TagNode => {
    let node = list.find((n) => n.name === name);
    if (!node) {
      node = { name, fullTag, count: 0, children: [] };
      list.push(node);
    }
    return node;
  };

  for (const { tag, count } of tags) {
    const segments = tag.split('/').filter(Boolean);
    if (segments.length === 0) continue;
    let list = roots;
    let path = '';
    let node: TagNode | null = null;
    for (const seg of segments) {
      path = path ? `${path}/${seg}` : seg;
      node = getOrCreate(list, seg, path);
      list = node.children;
    }
    if (node) node.count += count;
  }

  const sortRec = (list: TagNode[]): void => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** Total notes under a node (own count + descendants) for parent badges. */
function subtreeCount(node: TagNode): number {
  return node.count + node.children.reduce((sum, c) => sum + subtreeCount(c), 0);
}

export function TagsPanel() {
  const [tags, setTags] = useState<TagCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const openSearchWithQuery = useAppStore((s) => s.openSearchWithQuery);
  const coreReady = useAppStore((s) => s.coreReady);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTags(await tagsList());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTags([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, coreReady]);

  const tree = useMemo(() => buildTagTree(tags ?? []), [tags]);

  const toggleCollapsed = (fullTag: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(fullTag)) next.delete(fullTag); else next.add(fullTag);
      return next;
    });
  };

  const renderNode = (node: TagNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.fullTag);
    const badge = hasChildren ? subtreeCount(node) : node.count;
    return (
      <div key={node.fullTag}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            paddingLeft: 10 + depth * 14,
            fontSize: 11,
            cursor: 'pointer',
            borderRadius: 4,
            color: 'var(--ink-dim)',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--hover)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        >
          {hasChildren ? (
            <span
              onClick={(e) => { e.stopPropagation(); toggleCollapsed(node.fullTag); }}
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              style={{ width: 12, fontSize: 9, color: 'var(--ink-faint)', flexShrink: 0, textAlign: 'center' }}
            >
              {isCollapsed ? '▸' : '▾'}
            </span>
          ) : (
            <span style={{ width: 12, flexShrink: 0 }} />
          )}
          <span
            onClick={() => openSearchWithQuery(`tag:${node.fullTag}`)}
            title={`Search tag:${node.fullTag}`}
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--accent-2)',
            }}
          >
            #{node.name}
          </span>
          <span style={{
            fontSize: 9,
            padding: '1px 6px',
            background: 'var(--selection)',
            borderRadius: 8,
            color: 'var(--ink-dim)',
            flexShrink: 0,
          }}>
            {badge}
          </span>
        </div>
        {hasChildren && !isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  if (error) {
    return (
      <div style={{ padding: 12 }}>
        <div style={{
          padding: '8px 10px', borderRadius: 4, fontSize: 11,
          background: 'var(--hover)', border: '1px solid #ef4444', color: '#ef4444',
        }}>
          {error}
        </div>
        <button
          onClick={() => void load()}
          style={{
            marginTop: 8, padding: '4px 12px', fontSize: 11, border: 'none',
            borderRadius: 4, cursor: 'pointer', background: 'var(--hover)', color: 'var(--ink-dim)',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (tags === null) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
        Loading tags…
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20, lineHeight: 1.7 }}>
        No tags indexed yet.<br />Tags appear after the vault is indexed.
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 4px' }}>
      {tree.map((n) => renderNode(n, 0))}
    </div>
  );
}
