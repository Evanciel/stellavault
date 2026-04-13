// Backlinks panel — shows notes that link to the currently active note.

import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';

interface Backlink {
  filePath: string;
  name: string;
  line: string;
}

export function BacklinksPanel() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const openFile = useAppStore((s) => s.openFile);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeTitle = activeTab?.title ?? '';

  useEffect(() => {
    if (!activeTitle) { setBacklinks([]); return; }
    setLoading(true);
    void ipc('backlinks:find', activeTitle).then((results) => {
      // Exclude self
      setBacklinks(results.filter((r) => r.filePath !== activeTab?.filePath));
      setLoading(false);
    });
  }, [activeTitle, activeTab?.filePath]);

  if (!activeTitle) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>
        Open a note to see its backlinks
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
        Backlinks to "{activeTitle}"
      </div>

      {loading && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 11 }}>Scanning vault...</div>
      )}

      {!loading && backlinks.length === 0 && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 11, padding: 12, textAlign: 'center' }}>
          No notes link to this note yet.
          <div style={{ marginTop: 4, fontSize: 10 }}>
            Use [[{activeTitle}]] in other notes to create backlinks.
          </div>
        </div>
      )}

      {backlinks.map((bl) => (
        <div
          key={bl.filePath}
          onClick={async () => {
            const content = await ipc('vault:read-file', bl.filePath);
            openFile(bl.filePath, bl.name, content);
          }}
          style={{
            padding: '8px 10px',
            marginBottom: 4,
            borderRadius: 4,
            cursor: 'pointer',
            background: 'var(--hover)',
            border: '1px solid var(--border)',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; }}
        >
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
            {bl.name}
          </div>
          {bl.line && (
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', marginTop: 2, lineHeight: 1.4 }}>
              ...{bl.line.slice(0, 100)}...
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: 12, fontSize: 10, color: 'var(--ink-faint)' }}>
        {backlinks.length} backlink{backlinks.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
