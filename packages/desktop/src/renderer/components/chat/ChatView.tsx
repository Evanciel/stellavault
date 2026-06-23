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
import { useAppStore } from '../../stores/app-store.js';
import { isLocalProviderUrl } from '../../../shared/ai-providers.js';

import { AGENT_WRITE_TOOLS, shouldAutoRevealGraph } from './autoreveal.js';
import { MessageBubble, type BubbleState } from './MessageBubble.js';
import { Composer } from './Composer.js';
import type { ChatMessage, ChatCitation, ChatAttachment } from '../../../shared/ipc-types.js';

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
  // Agent mode (SP-E): the model can call vault tools (search/read/…) and propose a
  // confirm-gated write. Tool activity streams into toolLog; a write pauses on `confirm`.
  const [agentOn, setAgentOn] = useState(false);
  const [toolLog, setToolLog] = useState<Array<{ id: string; kind: 'call' | 'result'; name: string; text: string; ok?: boolean }>>([]);
  const [confirm, setConfirm] = useState<{ streamId: string; name: string; argsPreview: string } | null>(null);
  // Auto-distill (SP-I, Karpathy ingest): after each answer, fold the conversation into the
  // wiki. autoDistillRef/messagesRef are read inside the mount-once chat:done handler.
  const [autoDistill, setAutoDistill] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [distillSummary, setDistillSummary] = useState<string | null>(null);
  const autoDistillRef = useRef(autoDistill);
  autoDistillRef.current = autoDistill;
  const messagesRef = useRef<ChatMessage[]>(messages);
  const distillStreamRef = useRef<Set<string>>(new Set());
  // Auto-reveal the graph the FIRST time a write lands (then leave it to the user).
  const autoOpenedGraphRef = useRef(false);
  // Hermes-style rotating intro copy — one warm headline/body per mount.
  const [introIdx] = useState(() => Math.floor(Math.random() * 4));
  // Hermes-style disclosure: the tool-activity strip collapses to a summary row.
  const [toolsOpen, setToolsOpen] = useState(false);
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
  // SP2: show the 📎 attach affordance only for a local vision-capable setup (gemma4:e4b).
  // Same local-provider gate as Start-Ollama — local models we ship are vision-capable.
  const visionOn = canStartOllama;
  // Staged image attachments for the NEXT user turn (cleared on send / session switch).
  const [attachments, setAttachments] = useState<Array<{ uid: string } & ChatAttachment>>([]);
  const [pickingImages, setPickingImages] = useState(false);
  const pickImages = useCallback(() => {
    setPickingImages(true);
    void ipc('chat:pick-images')
      .then((r) => {
        const picked = ((r as { attachments?: ChatAttachment[] })?.attachments ?? [])
          .map((a) => ({ uid: crypto.randomUUID(), ...a }));
        if (picked.length > 0) setAttachments((prev) => [...prev, ...picked].slice(0, 6));
      })
      .catch(() => { /* dialog/read failure → no-op */ })
      .finally(() => setPickingImages(false));
  }, []);
  const removeAttachment = useCallback((uid: string) => {
    setAttachments((prev) => prev.filter((a) => a.uid !== uid));
  }, []);
  // Discard staged IMAGE attachments if the provider/endpoint changes (the view isn't remounted
  // on a settings change) — a cloud model can't see them. Audio/video transcripts are plain text
  // and stay valid across providers, so keep those.
  useEffect(() => { setAttachments((prev) => prev.filter((a) => a.type !== 'image')); }, [ai?.provider, ai?.baseURL]);

  // SP4: audio/video attach buttons are gated on the dedicated cloud key being set.
  const [transcribeOn, setTranscribeOn] = useState(false);
  const [videoOn, setVideoOn] = useState(false);
  useEffect(() => {
    void ipc('ai:has-secret', 'transcribeApiKey').then((v) => setTranscribeOn(!!v)).catch(() => {});
    void ipc('ai:has-secret', 'videoApiKey').then((v) => setVideoOn(!!v)).catch(() => {});
  }, []);
  const [pickingMedia, setPickingMedia] = useState(false);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const pickMedia = useCallback((kind: 'audio' | 'video') => {
    setPickingMedia(true);
    setMediaNote(null);
    void ipc('chat:pick-media', kind)
      .then((r) => {
        const res = r as { attachments?: ChatAttachment[]; error?: string };
        const picked = (res?.attachments ?? []).map((a) => ({ uid: crypto.randomUUID(), ...a }));
        if (picked.length > 0) setAttachments((prev) => [...prev, ...picked].slice(0, 6));
        else if (res?.error) setMediaNote(t(`panel.ai.mediaErr.${res.error}` as never) || res.error);
      })
      .catch(() => { /* dialog/transcribe failure → no-op */ })
      .finally(() => setPickingMedia(false));
  }, [t]);

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
      // Auto-distill (SP-I): fold the just-finished conversation into the wiki. Fires per
      // answer; the ingest prompt de-dups (search → append/link over create) to avoid spam.
      if (autoDistillRef.current) {
        const distillId = crypto.randomUUID();
        distillStreamRef.current.add(distillId);
        setDistilling(true);
        setDistillSummary(null);
        void ipc('chat:distill', { messages: messagesRef.current, streamId: distillId, sessionId })
          .catch(() => { distillStreamRef.current.delete(distillId); setDistilling(false); });
      }
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

    // Agent (SP-E/I) — tool activity routed by streamId (chat stream OR distill stream).
    const ownsStream = (sid: string) => streamMapRef.current.has(sid) || distillStreamRef.current.has(sid);
    const offToolCall = onIpc('chat:tool-call', (p: unknown) => {
      const e = p as { streamId: string; name: string; detailRedacted: string };
      if (!ownsStream(e.streamId)) return;
      setToolLog((prev) => [...prev, { id: crypto.randomUUID(), kind: 'call', name: e.name, text: e.detailRedacted }]);
    });
    const offToolResult = onIpc('chat:tool-result', (p: unknown) => {
      const e = p as { streamId: string; name: string; ok: boolean; summary: string };
      if (!ownsStream(e.streamId)) return;
      setToolLog((prev) => [...prev, { id: crypto.randomUUID(), kind: 'result', name: e.name, text: e.summary, ok: e.ok }]);
      // Split-view: the first successful write reveals the graph so the user watches the
      // vault grow (agent OR auto-distill writes — both are "the wiki compiling"). Guards:
      //  • variant==='main' ONLY — the panel-variant chat LIVES in the right panel, so
      //    flipping rightPanel→'graph' would unmount this very ChatView and abort its own
      //    stream mid-write. The center-tab chat is independent of rightPanel, so it's safe.
      //  • only when nothing else is open (rightPanel==='none') — never steal a panel the
      //    user explicitly chose, and never re-grab one they deliberately closed.
      if (e.ok && AGENT_WRITE_TOOLS.has(e.name) && !autoOpenedGraphRef.current && variant === 'main') {
        autoOpenedGraphRef.current = true; // arm once per mount regardless of the panel check
        const s = useAppStore.getState();
        if (shouldAutoRevealGraph({ ok: e.ok, toolName: e.name, alreadyOpened: false, variant, rightPanel: s.rightPanel })) {
          s.setRightPanel('graph');
        }
      }
    });
    const offToolConfirm = onIpc('chat:tool-confirm', (p: unknown) => {
      const e = p as { streamId: string; name: string; argsPreview: string };
      if (!streamMapRef.current.has(e.streamId)) return; // distill writes auto-apply (never confirm)
      setConfirm(e);
    });
    const offDistillDone = onIpc('chat:distill-done', (p: unknown) => {
      const e = p as { streamId: string; summary: string };
      if (!distillStreamRef.current.has(e.streamId)) return;
      distillStreamRef.current.delete(e.streamId);
      setDistilling(false);
      setDistillSummary(e.summary || null);
    });

    return () => {
      offChunk();
      offDone();
      offError();
      offToolCall();
      offToolResult();
      offToolConfirm();
      offDistillDone();
    };
  }, [syncActiveCount, sessionId, variant]);

  // Keep messagesRef current so the mount-once chat:done handler distills the latest turns.
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Approve/deny a write tool the agent requested.
  const respondConfirm = useCallback((approve: boolean) => {
    setConfirm((cur) => {
      if (cur) void ipc('chat:tool-approve', { streamId: cur.streamId, approve }).catch(() => {});
      return null;
    });
  }, []);

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
    // SP2/SP4: images only ship to a vision provider (re-read visionOn so a provider switch can't
    // smuggle them to a cloud/text model); audio/video are plain-text transcripts, valid anywhere.
    const sendable = attachments.filter((a) => (a.type === 'image' ? visionOn : true));
    if ((!text && sendable.length === 0) || atCap) return;

    const newStreamId = crypto.randomUUID();
    const userTurn: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      ts: Date.now(),
      // strip the renderer-only uid; main re-validates the data URLs at the content level.
      ...(sendable.length > 0 ? { attachments: sendable.map(({ uid, ...a }) => a) } : {}),
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
    setAttachments([]);   // staged images consumed by this turn
    setError(null);
    setCapMessage(false);
    setToolLog([]);   // fresh tool trace per turn
    setConfirm(null);
    // Register the route BEFORE invoking chat:send. The mount-once subscription
    // is already attached, so any chunk for newStreamId resolves immediately.
    streamMapRef.current.set(newStreamId, assistantTurn.id);
    syncActiveCount();

    void ipc('chat:send', {
      messages: outbound,
      streamId: newStreamId,
      sessionId,
      ragOn,
      agentOn,
    }).catch(() => {
      // The invoke promise rejects ONLY for the synchronous guards (cap reached /
      // duplicate / validation). Stream-time failures arrive as 'chat:error'.
      // Roll back the optimistic assistant bubble and surface the cap note.
      setCapMessage(true);
      streamMapRef.current.delete(newStreamId);
      syncActiveCount();
      setMessages((prev) => prev.filter((m) => m.id !== assistantTurn.id));
    });
  }, [input, atCap, messages, ragOn, agentOn, attachments, visionOn, sessionId, syncActiveCount]);

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
            // Main view: a text-forward, warm hero (Hermes intro style) — a rotating
            // second-person headline + body, left-aligned to the composer column.
            <div style={{ maxWidth: MAIN_COL, margin: '0 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '52vh', gap: 12 }}>
              <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)', lineHeight: 1.15 }}>
                {t(`panel.ai.intro.${introIdx}.title` as never)}
              </div>
              <div style={{ fontSize: 15, color: 'var(--ink-dim)', maxWidth: 540, lineHeight: 1.6 }}>
                {t(`panel.ai.intro.${introIdx}.body` as never)}
              </div>
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

      {/* Agent tool-activity (SP-E) — Hermes-style disclosure: a tertiary summary row that
          shows the latest step + a step count, expanding to the full trace on click. */}
      {agentOn && toolLog.length > 0 && (() => {
        const latest = toolLog[toolLog.length - 1];
        const steps = toolLog.filter((l) => l.kind === 'call').length;
        const rows = toolsOpen ? toolLog.slice(-8) : [latest];
        return (
          <div style={{ padding: isMain ? '0 16px 6px' : '0 10px 6px' }}>
            <div style={{ maxWidth: isMain ? 768 : undefined, margin: isMain ? '0 auto' : undefined }}>
              <button
                onClick={() => setToolsOpen((v) => !v)}
                aria-expanded={toolsOpen}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 10.5, fontWeight: 600 }}
              >
                <span aria-hidden style={{ display: 'inline-block', transform: toolsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', opacity: 0.7 }}>▸</span>
                {steps > 0 ? t('panel.ai.agentSteps').replace('{n}', String(steps)) : t('panel.ai.agentWorking')}
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                {rows.map((tlog) => (
                  <div key={tlog.id} style={{ fontSize: 11, color: 'var(--ink-dim)', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span aria-hidden style={{ opacity: 0.8 }}>{tlog.kind === 'call' ? '🔧' : tlog.ok === false ? '⚠️' : '✓'}</span>
                    <span style={{ fontWeight: 600 }}>{tlog.name}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8 }}>{tlog.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Write-approval card (SP-E) — the agent proposed a vault WRITE; it runs only on Approve. */}
      {confirm && (
        <div style={{ padding: isMain ? '0 16px 8px' : '0 10px 8px' }}>
          <div style={{
            maxWidth: isMain ? 768 : undefined, margin: isMain ? '0 auto' : undefined,
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 6 }}>
              ✍️ {t('panel.ai.agentWriteConfirm')} <span style={{ fontWeight: 700 }}>{confirm.name}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-dim)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8 }}>
              {confirm.argsPreview}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => respondConfirm(true)} style={{ padding: '5px 16px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
                {t('panel.ai.agentApprove')}
              </button>
              <button onClick={() => respondConfirm(false)} style={{ padding: '5px 16px', fontSize: 12, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--ink-dim)', cursor: 'pointer' }}>
                {t('panel.ai.agentDeny')}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Auto-distill indicator (SP-I) — the wiki is being compiled from this conversation. */}
      {(distilling || distillSummary) && (
        <div style={{ padding: isMain ? '0 16px 4px' : '0 10px 4px', fontSize: 10.5, color: 'var(--accent-2)', textAlign: isMain ? 'center' : 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {distilling ? `🗂 ${t('panel.ai.distilling')}` : `🗂 ${t('panel.ai.distilled')}${distillSummary ? `: ${distillSummary}` : ''}`}
        </div>
      )}

      {/* SP4 media transcription status / error */}
      {(pickingMedia || mediaNote) && (
        <div style={{ padding: isMain ? '0 16px 4px' : '0 10px 4px', fontSize: 10.5, color: pickingMedia ? 'var(--accent-2)' : '#e5854d', textAlign: isMain ? 'center' : 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pickingMedia ? `🎧 ${t('panel.ai.transcribing')}` : mediaNote}
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
        agentOn={agentOn}
        onAgentToggle={setAgentOn}
        autoDistill={autoDistill}
        onAutoDistillToggle={setAutoDistill}
        attachments={attachments.map((a) => ({ id: a.uid, type: a.type, fileName: a.fileName, dataUrl: a.dataUrl, transcript: a.transcript }))}
        onPickImages={pickImages}
        onRemoveAttachment={removeAttachment}
        visionOn={visionOn}
        pickingImages={pickingImages}
        onPickMedia={pickMedia}
        transcribeOn={transcribeOn}
        videoOn={videoOn}
        pickingMedia={pickingMedia}
        variant={variant}
      />
    </div>
  );
}
