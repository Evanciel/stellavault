// Edit form for node documents: title, content (TipTap), tags, save/cancel

import type { SaveStatus } from './useNodeDetail.js';
import { useGraphStore } from '../stores/graph-store.js';
import { TipTapEditor } from './TipTapEditor.js';
import { t } from '../lib/i18n.js';

interface NodeEditFormProps {
  editTitle: string;
  setEditTitle: (v: string) => void;
  editContent: string;
  setEditContent: (v: string) => void;
  editTags: string;
  setEditTags: (v: string) => void;
  saveStatus: SaveStatus;
  onSave: () => void;
  isDark: boolean;
}

export function NodeEditForm({
  editTitle, setEditTitle,
  editContent, setEditContent,
  editTags, setEditTags,
  saveStatus, onSave,
  isDark,
}: NodeEditFormProps) {
  const border = isDark ? 'rgba(100, 120, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)';
  const textPrimary = isDark ? '#e0e0f0' : '#1a1a2e';
  const tagColor = isDark ? '#88aaff' : '#4466aa';
  const btnBg = isDark ? 'rgba(100, 120, 255, 0.1)' : 'rgba(80, 100, 200, 0.06)';
  const btnBorder = isDark ? 'rgba(100, 120, 255, 0.2)' : 'rgba(80, 100, 200, 0.15)';
  const btnColor = isDark ? '#88aaff' : '#4466aa';

  return (
    <div style={{ marginBottom: '14px' }}>
      <input
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value)}
        placeholder="Title"
        style={{
          width: '100%', padding: '6px 8px', marginBottom: '6px',
          background: isDark ? 'rgba(100,120,255,0.08)' : 'rgba(0,0,0,0.03)',
          border: `1px solid ${border}`, borderRadius: '5px',
          color: textPrimary, fontSize: '13px', fontWeight: 600, outline: 'none',
        }}
      />
      <input
        value={editTags}
        onChange={(e) => setEditTags(e.target.value)}
        placeholder="Tags (comma separated)"
        style={{
          width: '100%', padding: '5px 8px', marginBottom: '6px',
          background: isDark ? 'rgba(100,120,255,0.08)' : 'rgba(0,0,0,0.03)',
          border: `1px solid ${border}`, borderRadius: '5px',
          color: tagColor, fontSize: '11px', outline: 'none',
        }}
      />
      <div style={{
        border: `1px solid ${border}`, borderRadius: '8px',
        background: isDark ? 'rgba(100,120,255,0.03)' : 'rgba(0,0,0,0.01)',
        padding: '8px 12px', minHeight: '200px',
      }}>
        <TipTapEditor
          content={editContent}
          isDark={isDark}
          editable={true}
          onSave={(md) => setEditContent(md)}
          onWikilinkClick={(target) => {
            const store = useGraphStore.getState();
            const node = store.nodes.find(n =>
              n.label?.toLowerCase().includes(target.toLowerCase())
            );
            if (node) { store.selectNode(node.id); store.setHighlightedNodes([node.id]); }
          }}
        />
      </div>
      <button
        onClick={onSave}
        disabled={saveStatus === 'saving'}
        style={{
          width: '100%', padding: '8px', marginTop: '6px',
          background: saveStatus === 'saved' ? (isDark ? 'rgba(16,185,129,0.2)' : 'rgba(5,150,105,0.1)') : btnBg,
          border: `1px solid ${btnBorder}`, borderRadius: '5px',
          color: saveStatus === 'saved' ? (isDark ? '#10b981' : '#059669') : btnColor,
          fontSize: '12px', fontWeight: 600, cursor: 'pointer',
        }}
      >
        {saveStatus === 'saving' ? t('node.saving') : saveStatus === 'saved' ? t('node.saved') : saveStatus === 'error' ? t('node.saveError') : t('node.save')}
      </button>
    </div>
  );
}
