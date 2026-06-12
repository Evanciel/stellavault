// Frontmatter Properties editor (W1-7, plan §W1-7).
// Collapsible key-value grid rendered above the markdown editor.
// Type inference per value: boolean → checkbox, number → number input,
// array → chips, YYYY-MM-DD string → date input, everything else → text.
// All edits flow up via onChange (EditorArea recomposes tab content).

import { useState } from 'react';

interface Props {
  frontmatter: Record<string, unknown>;
  onChange: (fm: Record<string, unknown>) => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Rebuild the object preserving key order, replacing one key's value. */
function withValue(fm: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fm)) out[k] = k === key ? value : fm[k];
  return out;
}

/** Rebuild preserving order, renaming a key in place. */
function withRenamedKey(fm: Record<string, unknown>, oldKey: string, newKey: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fm)) {
    if (k === oldKey) out[newKey] = fm[oldKey];
    else out[k] = fm[k];
  }
  return out;
}

function withoutKey(fm: Record<string, unknown>, key: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fm)) if (k !== key) out[k] = fm[k];
  return out;
}

export function PropertiesEditor({ frontmatter, onChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [addingKey, setAddingKey] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const keys = Object.keys(frontmatter);
  if (keys.length === 0 && !showAdd) {
    // No properties — slim affordance only (Obsidian-like).
    return (
      <div style={{ marginBottom: 8 }}>
        <button
          onClick={() => setShowAdd(true)}
          aria-label="Add property"
          style={addLinkStyle}
        >+ Add property</button>
      </div>
    );
  }

  const commitAdd = () => {
    const key = addingKey.trim();
    setShowAdd(false);
    setAddingKey('');
    if (!key || key in frontmatter) return;
    onChange({ ...frontmatter, [key]: '' });
  };

  return (
    <div style={{
      marginBottom: 16, border: '1px solid var(--border)', borderRadius: 6,
      background: 'var(--bg-3)', fontSize: 12,
    }}>
      {/* Header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        aria-expanded={!collapsed}
        aria-label="Toggle properties"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
          cursor: 'pointer', color: 'var(--ink-dim)', userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 9, width: 10 }}>{collapsed ? '▶' : '▼'}</span>
        <span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Properties
        </span>
        <span style={{ color: 'var(--ink-faint)' }}>{keys.length}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: '0 10px 8px' }}>
          {keys.map((key) => (
            <PropertyRow
              key={key}
              propKey={key}
              value={frontmatter[key]}
              onRename={(newKey) => {
                const nk = newKey.trim();
                if (!nk || (nk !== key && nk in frontmatter)) return;
                if (nk !== key) onChange(withRenamedKey(frontmatter, key, nk));
              }}
              onValue={(v) => onChange(withValue(frontmatter, key, v))}
              onRemove={() => onChange(withoutKey(frontmatter, key))}
            />
          ))}

          {showAdd ? (
            <input
              autoFocus
              value={addingKey}
              onChange={(e) => setAddingKey(e.target.value)}
              onBlur={commitAdd}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitAdd();
                if (e.key === 'Escape') { setShowAdd(false); setAddingKey(''); }
              }}
              placeholder="property name"
              aria-label="New property name"
              style={{ ...inputStyle, marginTop: 4, width: 160 }}
            />
          ) : (
            <button onClick={() => setShowAdd(true)} aria-label="Add property" style={addLinkStyle}>
              + Add property
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function PropertyRow({ propKey, value, onRename, onValue, onRemove }: {
  propKey: string;
  value: unknown;
  onRename: (newKey: string) => void;
  onValue: (v: unknown) => void;
  onRemove: () => void;
}) {
  const [keyDraft, setKeyDraft] = useState(propKey);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '3px 0' }}>
      <input
        value={keyDraft}
        onChange={(e) => setKeyDraft(e.target.value)}
        onBlur={() => onRename(keyDraft)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        aria-label={`Property key ${propKey}`}
        style={{ ...inputStyle, width: 120, color: 'var(--ink-dim)', flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <ValueEditor value={value} onValue={onValue} label={propKey} />
      </div>
      <button
        onClick={onRemove}
        title={`Remove ${propKey}`}
        aria-label={`Remove property ${propKey}`}
        style={{
          border: 'none', background: 'transparent', color: 'var(--ink-faint)',
          cursor: 'pointer', fontSize: 12, padding: '2px 4px', flexShrink: 0,
        }}
      >×</button>
    </div>
  );
}

// ─── Value editors (type inference) ──────────────────────────────────────────

function ValueEditor({ value, onValue, label }: {
  value: unknown;
  onValue: (v: unknown) => void;
  label: string;
}) {
  if (typeof value === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onValue(e.target.checked)}
        aria-label={`${label} value`}
        style={{ marginTop: 4 }}
      />
    );
  }

  if (typeof value === 'number') {
    return (
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const n = Number(e.target.value);
          onValue(Number.isNaN(n) ? 0 : n);
        }}
        aria-label={`${label} value`}
        style={{ ...inputStyle, width: 120 }}
      />
    );
  }

  if (Array.isArray(value)) {
    return <ChipsEditor items={value} onItems={onValue} label={label} />;
  }

  if (typeof value === 'string' && DATE_RE.test(value)) {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onValue(e.target.value)}
        aria-label={`${label} value`}
        style={{ ...inputStyle, width: 140, colorScheme: 'dark' }}
      />
    );
  }

  if (value !== null && typeof value === 'object') {
    // Nested objects: read-only JSON (editing nested YAML is Wave 2 scope).
    return (
      <input
        value={JSON.stringify(value)}
        readOnly
        title="Nested objects are read-only here — edit in the note source"
        aria-label={`${label} value (read-only)`}
        style={{ ...inputStyle, width: '100%', opacity: 0.6 }}
      />
    );
  }

  return (
    <input
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onValue(e.target.value)}
      aria-label={`${label} value`}
      style={{ ...inputStyle, width: '100%' }}
    />
  );
}

function ChipsEditor({ items, onItems, label }: {
  items: unknown[];
  onItems: (v: unknown[]) => void;
  label: string;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    setDraft('');
    if (!v) return;
    onItems([...items, v]);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {items.map((item, i) => (
        <span
          key={`${String(item)}-${i}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'var(--hover)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '1px 8px', color: 'var(--ink)', fontSize: 11,
          }}
        >
          {String(item)}
          <button
            onClick={() => onItems(items.filter((_, j) => j !== i))}
            aria-label={`Remove ${String(item)} from ${label}`}
            style={{ border: 'none', background: 'transparent', color: 'var(--ink-faint)', cursor: 'pointer', padding: 0, fontSize: 11 }}
          >×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(); }
          if (e.key === 'Backspace' && draft === '' && items.length > 0) {
            onItems(items.slice(0, -1));
          }
        }}
        onBlur={() => { if (draft.trim()) add(); }}
        placeholder="+ add"
        aria-label={`Add item to ${label}`}
        style={{ ...inputStyle, width: 70 }}
      />
    </div>
  );
}

// ─── Shared styles (CSS variables per plan §4-E) ─────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '3px 7px',
  fontSize: 12,
  color: 'var(--ink)',
  outline: 'none',
};

const addLinkStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--ink-faint)',
  cursor: 'pointer',
  fontSize: 11,
  padding: '3px 0',
};
