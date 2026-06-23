// SP1 chat — conversation view (multimedia-chat-sp1-plan §7, ⑨).
//
// SESSION-PROP-DRIVEN (⑨ refactor): this view no longer owns the session id. The
// parent ChatPanel passes { sessionId, initialMessages } and remounts the view
// (key={currentSessionId}) on every switch. That remount runs the unmount
// abort-all below, so switching/closing a conversation cancels any in-flight
// stream automatically — no separate switch-abort path needed.
//
// Owns the live chat session in the renderer:
//   • messages: ChatMessage[]        — seeded from props.initialMessages
//   • streamMapRef: Map<id, msgId>   — in-flight assistant streams (empty = idle)
//   • props.sessionId: string        — the session this view is bound to
//   • error, ragOn                   — UI state; ragOn defaults TRUE
//
// On chat:done the view calls props.onSaved?.() so the parent can refresh the
// session list (main persists the session on chat:done).
//
// Concurrency = hard-reject-at-2 (Locked Decision 3): up to TWO assistant streams
// may run at once; the 3rd chat:send is rejected by the main handler and the
// renderer disables Send while two are active.
//
// Streaming contract (Invariant §6): the renderer NEVER talks to a provider and
// NEVER fetches remote bytes. It only invokes 'chat:send'/'chat:abort' and
// listens for the targeted 'chat:chunk'/'chat:done'/'chat:error' events. Those
// events fire for ALL chat streams on this window, so EVERY handler resolves the
// target bubble from the event's streamId (via streamMapRef), never a single
// shared ref — this keeps two concurrent streams from cross-contaminating. The
// subscription is attached ONCE on mount (before any chat:send can fire) and
// torn down on unmount, where every in-flight stream is also aborted.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc, onIpc } from '../../lib/ipc-client.js';
import { useT } from '../../lib/i18n.js';
import { useStickToBottom } from '../../lib/use-stick-to-bottom.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import { isLocalProviderUrl } from '../../../shared/ai-providers.js';
import { MessageBubble, type BubbleState } from './MessageBubble.js';
import { Composer } from './Composer.js';
import type { ChatMessage, ChatCitation } from '../../../shared/ipc-types.js';

const MAX_CONCURRENT = 2;

const ERROR_LABEL_KEY: Record<string, Parameters<ReturnType<typeof useT>>[0]> = {
  'key-missing': 'panel.ai.errorKeyMissing',
  'rate-limited': 'panel.ai.errorRateLimited',
  refused: 'panel.ai.errorRefused',
  'too-large': 'panel.ai.errorTooLarge',
  aborted: 'panel.ai.chatAborted',
  unreachable: 'panel.ai.errorUnreachable',
  'model-missing': 'panel.ai.errorModelMissing',
  generic: 'panel.ai.errorGeneric',
};

interface ChatError {
  streamId: string;
  message: string;
  category?: string;
}

export interface ChatViewProps {
  /** The session this view is bound to. Parent remounts (key) on switch. */
  sessionId: string;
  /** Turns to seed the transcript with (loaded session, or [] for a fresh chat). */
  initialMessages: ChatMessage[];
  /** Called after a stream completes (chat:done) so the parent can refresh the
      session list — main persists the session on chat:done. */
  onSaved?: () => void;
  /** 'panel' = narrow right-panel; 'main' = roomy centered main-view (ChatGPT-style). */
  variant?: 'panel' | 'main';
}

// Centered reading column for the main view — keeps long transcripts comfortable
// on a wide center pane instead of stretching edge-to-edge.
const MAIN_COL = 768;

export function ChatView({ sessionId, initialMessages, onSaved, variant = 'panel' }: ChatViewProps) {
  const t = useT();
  const isMain = variant === 'main';
  const colStyle = isMain ? { width: '100%', maxWidth: MAIN_COL, margin: '0 auto' } as const : undefined;
  // NOTE: initialMessages is read ONLY at mount (useState initializer). Correctness
  // depends on the parent remounting via key={currentSessionId} on every switch, so
  // a changed sessionId always brings a fresh mount with fresh initialMessages.
  // If a same-key reload (same sessionId, new turns) is ever needed, add a
  // useEffect that resets messages when sessionId changes.
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [error, setError] = useState<ChatError | null>(null);
  const [ragOn, setRagOn] = useState(true);
  const [input, setInput] = useState('');
  // capMessage = transient note when the main handler rejects a 3rd stream.
  const [capMessage, setCapMessage] = useState(false);
  // activeCount drives Stop/Composer affordances; mirrors streamMapRef.size.
  const [activeCount, setActiveCount] = useState(0);
  // Bubble ids the user explicitly Stopped — render an 'aborted' (not
  // 'incomplete') status line. Kept renderer-local; the persisted message still
  // carries incomplete:true so at-rest semantics are unchanged.
  const [abortedIds, setAbortedIds] = useState<ReadonlySet<string>>(new Set());
  // True while an 'unreachable'-error "Start Ollama" request is in flight.
  const [startingOllama, setStartingOllama] = useState(false);

  // Provider config — drives whether the 'unreachable' error offers "Start Ollama"
  // (only when the configured provider is a LOCAL openai-compatible server).
  const ai = useSettingsStore((s) => s.settings.ai);
  const canStartOllama =
    ai?.provider === 'openai-compatible' && isLocalProviderUrl(ai?.baseURL ?? '');

  // onSaved is read from a ref inside the mount-once subscription so a changing
  // callback identity never re-subscribes (keeps the mount-once invariant).
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  // streamId -> assistant message id. The single source of truth for routing
  // chunk/done/error to the right bubble under concurrency. Read synchronously
  // by the mount-once subscription and the abort-all teardown.
  const streamMapRef = useRef<Map<string, string>>(new Map());

  const isStreaming = activeCount > 0;
  const atCap = activeCount >= MAX_CONCURRENT;

  const syncActiveCount = useCallback(() => {
    setActiveCount(streamMapRef.current.size);
  }, []);

  const lastAssistantText =
    messages.length > 0 ? messages[messages.length - 1].text : '';
  const stick = useStickToBottom([messages.length, lastAssistantText.length, activeCount]);

  // ─── Streaming event subscription — attached ONCE on mount ───
  // Attaching before any chat:send can fire closes the subscribe-after-send race
  // (a synchronous chat:send in send() would otherwise out-race a per-streamId
  // effect that only runs post-commit, dropping the first chunk/early error).
  // Each handler resolves its target bubble from streamMapRef by streamId.
  useEffect(() => {
    const offChunk = onIpc('chat:chunk', (p: unknown) => {
      const e = p as { streamId: string; delta: string };
      const msgId = streamMapRef.current.get(e.streamId);
      if (!msgId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, text: m.text + e.delta } : m)),
      );
    });

    const offDone = onIpc('chat:done', (p: unknown) => {
      const e = p as { streamId: string; citations?: ChatCitation[] };
      const msgId = streamMapRef.current.get(e.streamId);
      if (!msgId) return;
      if (e.citations && e.citations.length > 0) {
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, citations: e.citations } : m)),
        );
      }
      streamMapRef.current.delete(e.streamId);
      syncActiveCount();
      // The session was persisted by main on chat:done — let the parent refresh
      // its session list (new title / updated time / first-save row).
      onSavedRef.current?.();
    });

    const offError = onIpc('chat:error', (p: unknown) => {
      const e = p as ChatError;
      const msgId = streamMapRef.current.get(e.streamId);
      if (!msgId) return;
      setError(e);
      // Mark the half-streamed assistant turn incomplete (keep partial text).
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, incomplete: true } : m)),
      );
      streamMapRef.current.delete(e.streamId);
      syncActiveCount();
    });

    return () => {
      offChunk();
      offDone();
      offError();
    };
  }, [syncActiveCount]);

  // ─── Abort ALL in-flight streams on unmount ───
  // Covers conversation switch too: switching remounts this view, firing this
  // teardown for every still-active stream so none orphan in the main registry.
  useEffect(() => {
    const map = streamMapRef.current;
    return () => {
      for (const sid of map.keys()) void ipc('chat:abort', sid).catch(() => {});
      map.clear();
    };
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || atCap) return;

    const newStreamId = crypto.randomUUID();
    const userTurn: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      ts: Date.now(),
    };
    const assistantTurn: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      ts: Date.now(),
    };

    // Build the outbound message list (existing turns + the new user turn).
    const outbound = [...messages, userTurn];

    setMessages([...outbound, assistantTurn]);
    setInput('');
    setError(null);
    setCapMessage(false);
    // Register the route BEFORE invoking chat:send. The mount-once subscription
    // is already attached, so any chunk for newStreamId resolves immediately.
    streamMapRef.current.set(newStreamId, assistantTurn.id);
    syncActiveCount();

    void ipc('chat:send', {
      messages: outbound,
      streamId: newStreamId,
      sessionId,
      ragOn,
    }).catch(() => {
      // The invoke promise rejects ONLY for the synchronous guards (cap reached /
      // duplicate / validation). Stream-time failures arrive as 'chat:error'.
      // Roll back the optimistic assistant bubble and surface the cap note.
      setCapMessage(true);
      streamMapRef.current.delete(newStreamId);
      syncActiveCount();
      setMessages((prev) => prev.filter((m) => m.id !== assistantTurn.id));
    });
  }, [input, atCap, messages, ragOn, sessionId, syncActiveCount]);

  // Stop the most-recently-started stream (the last live assistant bubble).
  const stop = useCallback(() => {
    const entries = [...streamMapRef.current.entries()];
    const last = entries[entries.length - 1];
    if (!last) return;
    const [sid, msgId] = last;
    void ipc('chat:abort', sid).catch(() => {});
    streamMapRef.current.delete(sid);
    syncActiveCount();
    // Optimistic: mark the stopped turn incomplete (persisted) + aborted (UI).
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, incomplete: true } : m)),
    );
    setAbortedIds((prev) => {
      const next = new Set(prev);
      next.add(msgId);
      return next;
    });
  }, [syncActiveCount]);

  const retry = useCallback(() => {
    setError(null);
    // Drop a trailing empty/incomplete assistant turn so retry doesn't leave an
    // orphan dead bubble in the transcript (and the next send appends cleanly).
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant' && (!last.text || last.incomplete)) {
        return prev.slice(0, -1);
      }
      return prev;
    });
    // Re-fill the composer with the last user turn's text for one-tap re-send.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) setInput(lastUser.text);
  }, [messages]);

  // "Start Ollama" on an 'unreachable' error: spawn the local server (main side),
  // then on success fold into retry() so the composer is re-armed with the last
  // question for a one-tap re-send. On failure the 'unreachable' banner stays put so
  // the user can try again (or open Settings → AI for the detailed reason).
  const startOllamaAndRetry = useCallback(() => {
    if (startingOllama) return;
    setStartingOllama(true);
    void ipc('ollama:start', { baseURL: ai?.baseURL ?? '' })
      .then((r) => { if (r?.ok) retry(); })
      .catch(() => { /* keep the unreachable banner; user can retry */ })
      .finally(() => setStartingOllama(false));
  }, [startingOllama, ai?.baseURL, retry]);

  // Bubble state resolver for each turn.
  const bubbleStateFor = (m: ChatMessage, isLast: boolean): BubbleState => {
    if (m.role !== 'assistant') return 'done';
    const isLive = streamMapRef.current.has(
      [...streamMapRef.current.entries()].find(([, mid]) => mid === m.id)?.[0] ?? '',
    );
    if (isLive) return 'streaming';
    if (error && isLast) return 'error';
    if (abortedIds.has(m.id)) return 'aborted';
    if (m.incomplete) return 'incomplete';
    return 'done';
  };

  const errorLabel = error
    ? t(ERROR_LABEL_KEY[error.category ?? 'generic'] ?? 'panel.ai.errorGeneric')
    : undefined;

  // "Start Ollama" action — only on a local-provider 'unreachable' error.
  const errorAction =
    error?.category === 'unreachable' && canStartOllama
      ? {
          label: startingOllama ? t('panel.ai.startingOllama') : t('panel.ai.startOllama'),
          onClick: startOllamaAndRetry,
          busy: startingOllama,
        }
      : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Scrollable transcript (position:relative anchors the jump button) */}
      <div
        ref={stick.scrollRef}
        onScroll={stick.onScroll}
        style={{ flex: 1, overflowY: 'auto', padding: isMain ? '28px 16px' : 10, minHeight: 0, position: 'relative' }}
      >
        {messages.length === 0 ? (
          isMain ? (
            // Main view: a centered hero empty-state (ChatGPT/agent style).
            <div style={{ maxWidth: MAIN_COL, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', gap: 10 }}>
              <div style={{ fontSize: 40, lineHeight: 1 }} aria-hidden>💬</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>{t('panel.ai.chatMainTitle')}</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-dim)', maxWidth: 460, lineHeight: 1.6 }}>{t('panel.ai.chatEmptyHint')}</div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 24 }}>
              {t('panel.ai.chatEmptyHint')}
            </div>
          )
        ) : (
          <div style={colStyle}>
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                variant={variant}
                state={bubbleStateFor(m, i === messages.length - 1)}
                errorLabel={i === messages.length - 1 && error ? errorLabel : undefined}
                onRetry={i === messages.length - 1 && error ? retry : undefined}
                action={i === messages.length - 1 && error ? errorAction : undefined}
              />
            ))}
          </div>
        )}

        {/* Jump-to-latest — INSIDE the position:relative scroll container so its
            absolute offsets anchor to the transcript, not an outer ancestor. */}
        {!stick.isPinned && messages.length > 0 && (
          <button
            onClick={stick.jumpToLatest}
            style={{
              position: 'sticky',
              float: 'right',
              bottom: 8,
              right: 8,
              padding: '4px 12px',
              fontSize: 10,
              borderRadius: 12,
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            }}
          >
            {t('panel.ai.jumpToLatest')} ↓
          </button>
        )}
      </div>

      {/* Stop button while streaming */}
      {isStreaming && (
        <div style={{ padding: '0 10px 6px', display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={stop}
            style={{
              padding: '4px 16px',
              fontSize: 11,
              borderRadius: 6,
              background: 'transparent',
              border: '1px solid #e5484d',
              color: '#e5484d',
              cursor: 'pointer',
            }}
          >
            {t('panel.ai.stopButton')}
          </button>
        </div>
      )}

      {capMessage && !atCap && (
        <div style={{ padding: '0 10px 4px', fontSize: 9.5, color: 'var(--ink-faint)' }}>
          {t('panel.ai.capReached')}
        </div>
      )}

      {/* Plaintext-at-rest disclosure (Decision 1) */}
      <div style={{ padding: isMain ? '0 16px 4px' : '0 10px 4px', fontSize: 9, color: 'var(--ink-faint)', textAlign: isMain ? 'center' : 'left' }}>
        {t('panel.ai.sessionError')}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSend={send}
        atCap={atCap}
        ragOn={ragOn}
        onRagToggle={setRagOn}
        variant={variant}
      />
    </div>
  );
}
