// SP1 ⑨ — minimal session switcher (multimedia-chat-sp1-plan §9).
//
// Owns the chat session selection and seeds ChatView with the right turns:
//   • currentSessionId  — the active session UUID (fresh = crypto.randomUUID())
//   • sessions          — ChatSessionMeta[] from 'chat:list-sessions' (newest-first)
//   • initialMessages   — turns for the current session (loaded, or [] for fresh)
//
// ChatView is rendered with key={currentSessionId}, so SWITCHING a session
// remounts ChatView. That remount runs ChatView's unmount abort-all, cancelling
// any in-flight stream — no separate switch-abort needed here (Invariant §6).
//
// CRUD is the minimal set: list / new / open / rename / delete. Session files are
// persisted by main on chat:done; this panel only reads + mutates metadata.

import { useCallback, useEffect, useState } from 'react';
import { ipc } from '../../lib/ipc-client.js';
import { useT } from '../../lib/i18n.js';
import { ChatView } from './ChatView.js';
import type { ChatMessage, ChatSessionMeta } from '../../../shared/ipc-types.js';

function relativeTime(updated: number): string {
  const diff = Date.now() - updated;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(updated).toLocaleDateString();
}

export interface ChatPanelProps {
  /** 'panel' = narrow right-panel (default); 'main' = roomy centered main-view tab. */
  variant?: 'panel' | 'main';
}

const MAIN_COL = 768;

export function ChatPanel({ variant = 'panel' }: ChatPanelProps) {
  const t = useT();
  const isMain = variant === 'main';
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => crypto.randomUUID());
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [initialMessages, setInitialMessages] = useState<ChatMessage[]>([]);
  const [listOpen, setListOpen] = useState(false);

  const refresh = useCallback(() => {
    void ipc('chat:list-sessions')
      .then((list) => {
        // Newest-first by updated time.
        setSessions([...list].sort((a, b) => b.updated - a.updated));
      })
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Start a fresh conversation: new UUID, empty transcript, switch to it.
  // INVARIANT: setInitialMessages MUST precede setCurrentSessionId in the same
  // tick — ChatView seeds messages from props.initialMessages ONLY at mount, and
  // the key={currentSessionId} change is what forces that remount. React batches
  // both setState calls in this handler, so the remount sees the fresh [].
  const newChat = useCallback(() => {
    setInitialMessages([]);
    setCurrentSessionId(crypto.randomUUID());
    setListOpen(false);
    // Reconcile the list against disk after the switch: a stream that completed
    // right at switch-time persists to its (old) sessionId in main, but the
    // unmounting ChatView's onSaved is gone, so refresh here so that just-saved
    // turn shows up in the list (correctness review — abort-vs-done race).
    refresh();
  }, [refresh]);

  // Open a saved session: load its turns, then switch (remounts ChatView).
  // INVARIANT (same as newChat): setInitialMessages MUST be set before
  // setCurrentSessionId, both inside this .then() so React batches them and the
  // remount seeds from the freshly-loaded turns.
  const openSession = useCallback((id: string) => {
    void ipc('chat:load-session', id)
      .then((msgs) => {
        setInitialMessages(msgs ?? []);
        setCurrentSessionId(id);
        setListOpen(false);
        refresh();
      })
      .catch(() => {
        // Corrupt / missing — fall back to an empty transcript bound to that id.
        setInitialMessages([]);
        setCurrentSessionId(id);
        setListOpen(false);
        refresh();
      });
  }, [refresh]);

  const renameSession = useCallback((id: string, current: string) => {
    const next = window.prompt(t('panel.ai.renamePrompt'), current);
    if (next == null) return;
    const title = next.trim();
    if (!title) return;
    void ipc('chat:rename-session', id, title)
      .then(() => refresh())
      .catch(() => {});
  }, [t, refresh]);

  const deleteSession = useCallback((id: string) => {
    if (!window.confirm(t('panel.ai.confirmDelete'))) return;
    void ipc('chat:delete-session', id)
      .then(() => {
        // If the active session was deleted, start a fresh chat.
        if (id === currentSessionId) {
          setInitialMessages([]);
          setCurrentSessionId(crypto.randomUUID());
        }
        refresh();
      })
      .catch(() => {});
  }, [t, refresh, currentSessionId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1, width: '100%', minWidth: 0 }}>
      {/* Session bar: New chat + a collapsible list toggle. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: isMain ? '8px 16px' : '6px 8px',
          borderBottom: '1px solid var(--border)',
          // main: full-width bar, inner controls centered to the reading column.
          ...(isMain ? { width: '100%', maxWidth: MAIN_COL, margin: '0 auto', boxSizing: 'border-box' as const } : null),
        }}
      >
        <button
          onClick={() => setListOpen((v) => !v)}
          aria-expanded={listOpen}
          style={{
            flex: 1,
            textAlign: 'left',
            padding: '4px 8px',
            fontSize: 11,
            background: 'var(--hover)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--ink-dim)',
            cursor: 'pointer',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {t('panel.ai.sessionsLabel')} ({sessions.length}) {listOpen ? '▾' : '▸'}
        </button>
        <button
          onClick={newChat}
          style={{
            padding: '4px 12px',
            fontSize: 11,
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 4,
            color: '#fff',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          + {t('panel.ai.newChat')}
        </button>
      </div>

      {/* Collapsible session list. */}
      {listOpen && (
        <div
          style={{
            maxHeight: 220,
            overflowY: 'auto',
            borderBottom: '1px solid var(--border)',
            padding: 6,
          }}
        >
          {sessions.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 10.5, padding: 16 }}>
              {t('panel.ai.noSessions')}
            </div>
          ) : (
            sessions.map((s) => {
              const active = s.id === currentSessionId;
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 8px',
                    marginBottom: 3,
                    borderRadius: 4,
                    background: active ? 'var(--selection)' : 'var(--hover)',
                    border: '1px solid var(--border)',
                    borderColor: active ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  <button
                    onClick={() => openSession(s.id)}
                    title={s.title}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      minWidth: 0,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        color: active ? 'var(--accent-2)' : 'var(--ink)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.title || t('panel.ai.newChat')}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--ink-faint)', marginTop: 1 }}>
                      {relativeTime(s.updated)}
                    </div>
                  </button>
                  <button
                    onClick={() => renameSession(s.id, s.title)}
                    title={t('panel.ai.renameSession')}
                    aria-label={t('panel.ai.renameSession')}
                    style={{
                      padding: '2px 6px',
                      fontSize: 10,
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      color: 'var(--ink-dim)',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => deleteSession(s.id)}
                    title={t('panel.ai.deleteSession')}
                    aria-label={t('panel.ai.deleteSession')}
                    style={{
                      padding: '2px 6px',
                      fontSize: 10,
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      color: '#e5484d',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* The conversation. key={currentSessionId} forces a remount on switch so
          ChatView's unmount abort-all cancels any in-flight stream. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatView
          key={currentSessionId}
          sessionId={currentSessionId}
          initialMessages={initialMessages}
          onSaved={refresh}
          onNewSession={newChat}
          onClearChat={newChat}
          variant={variant}
        />
      </div>
    </div>
  );
}
