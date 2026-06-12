// Calendar widget (W1-10) — month grid with "daily note exists" dots.
// Clicking a day opens (or creates from template) that day's daily note.
//
// Placement note: Sidebar.tsx is owned by another agent this stage, so the
// widget is mounted as a collapsible section inside DailyBrief.tsx (owned here).
//
// IPC note: 'vault:list-files' / 'vault:exists' typed wrappers live in
// ipc-client.ts which is owned by another agent — we go through the raw
// bridge helper (invokeIpcRaw) per the stage contract. 'vault:list-files'
// returns ABSOLUTE paths per the IPC contract; we only need basenames.

import { useEffect, useMemo, useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import { useAppStore } from '../../stores/app-store.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { invokeIpcRaw } from '../../lib/runtime-sync.js';
import { applyTemplate, formatDailyName } from '../../lib/templates.js';

// ─── Daily note open-or-create (exported — command registration in
//     lib/session-persist.ts reuses this for 'Open today's daily note') ───

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  return norm.slice(norm.lastIndexOf('/') + 1);
}

async function getVaultPath(): Promise<string> {
  return useAppStore.getState().vaultPath || await ipc('vault:get-path');
}

/** Absolute path of the daily-notes folder per current settings. */
async function dailyFolderPath(): Promise<string> {
  const { dailyNotes } = useSettingsStore.getState().settings;
  const vaultPath = await getVaultPath();
  return dailyNotes.folder ? `${vaultPath}/${dailyNotes.folder}` : vaultPath;
}

/** Load the daily template body, with {{...}} substitution applied. */
async function renderDailyTemplate(title: string, date: Date): Promise<string> {
  const { dailyNotes } = useSettingsStore.getState().settings;
  const tplPath = (dailyNotes.templatePath || '').trim();
  if (tplPath) {
    try {
      const vaultPath = await getVaultPath();
      // Absolute (drive letter or leading slash) used as-is, else vault-relative.
      const abs = /^([a-zA-Z]:[\\/]|\/)/.test(tplPath) ? tplPath : `${vaultPath}/${tplPath}`;
      const raw = await ipc('vault:read-file', abs);
      return applyTemplate(raw, { title, date });
    } catch (err) {
      console.warn('[daily] template read failed, falling back to default:', err);
    }
  }
  return `# ${title}\n\n`;
}

/** Open the daily note for `date`, creating it from the template if missing. */
export async function openDailyNote(date: Date = new Date()): Promise<void> {
  const { dailyNotes } = useSettingsStore.getState().settings;
  const name = formatDailyName(dailyNotes.format, date);
  const folder = await dailyFolderPath();
  const filePath = `${folder}/${name}.md`;
  const app = useAppStore.getState();

  try {
    const content = await ipc('vault:read-file', filePath);
    app.openFile(filePath, name, content);
    return;
  } catch {
    // Doesn't exist — create from template below.
  }

  if (dailyNotes.folder) {
    try { await ipc('vault:create-folder', folder); } catch { /* already exists */ }
  }
  const body = await renderDailyTemplate(name, date);
  await ipc('vault:create-file', filePath, body);
  const loaded = await ipc('vault:read-file', filePath);
  useAppStore.getState().openFile(filePath, name, loaded);
  const tree = await ipc('vault:read-tree');
  useAppStore.getState().setFileTree(tree);
}

// ─── Month grid ───

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function CalendarWidget() {
  const settings = useSettingsStore((s) => s.settings);
  const tabs = useAppStore((s) => s.tabs); // re-check dots after create
  const [collapsed, setCollapsed] = useState(false);
  const [cursor, setCursor] = useState<Dayjs>(() => dayjs().startOf('month'));
  // Lowercased basenames (no extension) of files in the daily folder.
  const [existing, setExisting] = useState<Set<string>>(new Set());

  const fmt = settings.dailyNotes.format || 'YYYY-MM-DD';

  // Load the daily folder listing — one vault:list-files call covers every
  // visible day (batched, per stage instruction; no per-day vault:exists).
  useEffect(() => {
    if (collapsed) return;
    let cancelled = false;
    void (async () => {
      try {
        const folder = await dailyFolderPath();
        const files = await invokeIpcRaw<string[]>('vault:list-files', folder, '.md');
        if (cancelled) return;
        const names = new Set(files.map((f) => basename(f).replace(/\.md$/i, '').toLowerCase()));
        setExisting(names);
      } catch {
        if (!cancelled) setExisting(new Set()); // folder may not exist yet
      }
    })();
    return () => { cancelled = true; };
  }, [collapsed, cursor, settings.dailyNotes.folder, tabs.length]);

  const grid = useMemo(() => {
    const start = cursor.startOf('month');
    const firstCell = start.subtract(start.day(), 'day'); // back to Sunday
    const cells: Dayjs[] = [];
    for (let i = 0; i < 42; i++) cells.push(firstCell.add(i, 'day'));
    return cells;
  }, [cursor]);

  const today = dayjs();

  return (
    <section style={{ marginBottom: 24 }}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        style={headerButtonStyle}
      >
        <span style={{ marginRight: 8 }}>{collapsed ? '▸' : '▾'}</span>
        Calendar
      </button>

      {!collapsed && (
        <div style={cardStyle}>
          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button aria-label="Previous month" onClick={() => setCursor((c) => c.subtract(1, 'month'))} style={navBtnStyle}>&#x2039;</button>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
              {cursor.format('MMMM YYYY')}
            </span>
            <button aria-label="Next month" onClick={() => setCursor((c) => c.add(1, 'month'))} style={navBtnStyle}>&#x203A;</button>
          </div>

          {/* Weekday header */}
          <div style={gridStyle}>
            {WEEKDAYS.map((d, i) => (
              <div key={`${d}-${i}`} style={{ fontSize: 9, color: 'var(--ink-faint)', textAlign: 'center', padding: '2px 0' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div style={gridStyle}>
            {grid.map((d) => {
              const inMonth = d.month() === cursor.month();
              const isToday = d.isSame(today, 'day');
              const hasNote = existing.has(d.format(fmt).toLowerCase());
              return (
                <button
                  key={d.format('YYYY-MM-DD')}
                  onClick={() => void openDailyNote(d.toDate())}
                  title={d.format(fmt)}
                  style={{
                    ...dayCellStyle,
                    color: inMonth ? 'var(--ink)' : 'var(--ink-faint)',
                    opacity: inMonth ? 1 : 0.45,
                    border: isToday ? '1px solid var(--accent)' : '1px solid transparent',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--hover)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={{ lineHeight: 1 }}>{d.date()}</span>
                  <span style={{
                    width: 4, height: 4, borderRadius: '50%', marginTop: 2,
                    background: hasNote ? 'var(--accent)' : 'transparent',
                  }} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Styles ───

const headerButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: '0 0 10px',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontFamily: 'inherit',
  textAlign: 'left',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '10px 12px',
};

const navBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--ink-dim)',
  cursor: 'pointer',
  fontSize: 14,
  padding: '2px 8px',
  borderRadius: 3,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 2,
};

const dayCellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  borderRadius: 4,
  padding: '3px 0 2px',
  fontSize: 10,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 24,
};
