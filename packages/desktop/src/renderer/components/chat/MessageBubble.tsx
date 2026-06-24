// SP1 chat — one chat turn bubble (multimedia-chat-sp1-plan §7).
//
// Role-styled bubble. ASSISTANT text is rendered through SanitizedMarkdown (the
// model-output XSS boundary — never render assistant text any other way). USER
// text is rendered as PLAIN TEXT (no markdown parse) so a user typing `<script>`
// or `[x](javascript:…)` is shown verbatim, not interpreted. Citation chips ride
// assistant turns; clicking one opens the note via the existing read-file→openFile
// path (same mechanism AskVault/Coach use).

import { useState, useEffect, useRef } from 'react';
import { useT } from '../../lib/i18n.js';
import { ipc } from '../../lib/ipc-client.js';
import { useAppStore } from '../../stores/app-store.js';
import { SanitizedMarkdown } from '../../lib/sanitize.js';
import type { ChatMessage } from '../../../shared/ipc-types.js';

export type BubbleState = 'streaming' | 'done' | 'error' | 'incomplete' | 'aborted';

export interface MessageBubbleProps {
  message: ChatMessage;
  /** Visual/interaction state for assistant bubbles. User bubbles are always 'done'. */
  state?: BubbleState;
  /** Error category label (assistant error bubbles) + optional retry. */
  errorLabel?: string;
  onRetry?: () => void;
  /** Extra inline action on error bubbles (e.g. "Start Ollama" for 'unreachable'). */
  action?: { label: string; onClick: () => void; busy?: boolean };
  /** 'panel' = compact bubbles; 'main' = roomy, ChatGPT-style (assistant borderless). */
  variant?: 'panel' | 'main';
}

export function MessageBubble({ message, state = 'done', errorLabel, onRetry, action, variant = 'panel' }: MessageBubbleProps) {
  const t = useT();
  const openFile = useAppStore((s) => s.openFile);
  const isUser = message.role === 'user';
  const isMain = variant === 'main';
  const [copied, setCopied] = useState(false);

  // Activity timer — ticks elapsed seconds while an assistant turn streams.
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);
  useEffect(() => {
    if (state !== 'streaming') return;
    if (!startRef.current) startRef.current = performance.now();
    const id = setInterval(() => setElapsed((performance.now() - startRef.current) / 1000), 200);
    return () => clearInterval(id);
  }, [state]);

  const copyMessage = () => {
    try {
      void navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard unavailable */ }
  };
  // Main view, assistant turn: render as a borderless "document" block (ChatGPT-style)
  // rather than a chat bubble, so long markdown answers read like a page. User turns
  // stay as a subtle right-aligned bubble in both variants.
  const flat = isMain && !isUser && state !== 'error';

  const openCitation = async (filePath: string, title: string) => {
    if (!filePath) return;
    try {
      const content = await ipc('vault:read-file', filePath);
      openFile(filePath, title, content);
    } catch (err) {
      console.error('[MessageBubble] failed to open citation', err);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: isMain ? 18 : 10,
      }}
    >
      <div
        style={{
          maxWidth: flat ? '100%' : isMain ? '85%' : '92%',
          padding: flat ? '2px 0' : isMain ? '10px 14px' : '8px 11px',
          borderRadius: flat ? 0 : isMain ? 14 : 10,
          fontSize: isMain ? 14 : 12.5,
          lineHeight: 1.6,
          color: 'var(--ink)',
          background: flat ? 'transparent' : isUser ? 'var(--selection)' : 'var(--hover)',
          border: flat ? 'none' : '1px solid var(--border)',
          borderColor: state === 'error' ? '#e5484d' : 'var(--border)',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        }}
      >
        {isUser ? (
          // USER turns: plain text, never markdown-parsed. whiteSpace preserves
          // newlines the user typed without enabling any markup.
          <>
            {message.attachments && message.attachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: message.text ? 6 : 0 }}>
                {message.attachments.map((a, i) => (
                  a.type === 'image' ? (
                    <img key={`${a.fileName}-${i}`} src={a.dataUrl} alt={a.fileName} title={a.fileName}
                      style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8, border: '1px solid var(--border)', objectFit: 'contain' }} />
                  ) : (
                    <details key={`${a.fileName}-${i}`} style={{ maxWidth: 260, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--hover)', fontSize: 11.5 }}>
                      <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                        {a.type === 'audio' ? '🎵' : '🎬'} {a.fileName}
                      </summary>
                      {a.transcript && (
                        <div style={{ marginTop: 5, fontSize: 10.5, color: 'var(--ink-dim)', whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>{a.transcript}</div>
                      )}
                    </details>
                  )
                ))}
              </div>
            )}
            {message.text && <div style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>}
          </>
        ) : state === 'error' ? (
          <div style={{ color: 'var(--ink-dim)' }}>
            {errorLabel ?? t('panel.ai.errorGeneric')}
            {action && (
              <button
                onClick={action.onClick}
                disabled={action.busy}
                style={{
                  marginLeft: 8,
                  padding: '1px 8px',
                  fontSize: 10,
                  cursor: action.busy ? 'default' : 'pointer',
                  background: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  borderRadius: 3,
                  color: '#fff',
                  opacity: action.busy ? 0.6 : 1,
                }}
              >
                {action.label}
              </button>
            )}
            {onRetry && (
              <button
                onClick={onRetry}
                style={{
                  marginLeft: 8,
                  padding: '1px 8px',
                  fontSize: 10,
                  cursor: 'pointer',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  color: 'var(--ink-dim)',
                }}
              >
                {t('panel.ai.retryButton')}
              </button>
            )}
          </div>
        ) : (
          // ASSISTANT turns: the ONLY place assistant markdown is rendered.
          <div className="sv-chat-md">
            {message.text
              ? <SanitizedMarkdown>{message.text}</SanitizedMarkdown>
              : <span style={{ color: 'var(--ink-faint)' }}>{t('panel.ai.streamingMessage')}</span>}
            {state === 'streaming' && (
              <>
                <span aria-hidden style={{ opacity: 0.5 }}> ▌</span>
                {elapsed >= 0.6 && (
                  <span style={{ marginLeft: 8, fontSize: 10.5, color: 'var(--ink-faint)', fontVariantNumeric: 'tabular-nums' }}>{elapsed.toFixed(1)}s</span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Assistant message actions (done) — Copy. Subtle; brightens on hover. */}
      {!isUser && state !== 'error' && state !== 'streaming' && message.text && (
        <button
          onClick={copyMessage}
          aria-label={t('panel.ai.copyMessage')}
          style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', color: copied ? 'var(--accent-2)' : 'var(--ink-faint)', fontSize: 10.5, fontWeight: 600, opacity: 0.75 }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.75'; }}
        >
          {copied ? `✓ ${t('panel.ai.copied')}` : `⧉ ${t('panel.ai.copy')}`}
        </button>
      )}

      {/* aborted / incomplete status line (assistant bubbles) */}
      {!isUser && (state === 'aborted' || state === 'incomplete' || message.incomplete) && state !== 'error' && (
        <div style={{ fontSize: 9, color: 'var(--ink-faint)', marginTop: 2, fontStyle: 'italic' }}>
          {state === 'aborted' ? t('panel.ai.chatAborted') : t('panel.ai.chatIncomplete')}
        </div>
      )}

      {/* Citation chips — title-only; click opens the note (filePath). */}
      {!isUser && message.citations && message.citations.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5, maxWidth: '92%' }}>
          {message.citations.map((c, i) => {
            const clickable = !!c.filePath;
            return (
              <span
                key={`${c.filePath || c.title}-${i}`}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => void openCitation(c.filePath, c.title) : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === 'Enter') void openCitation(c.filePath, c.title); } : undefined}
                title={clickable ? `Open ${c.title}` : c.title}
                style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: 'var(--selection)',
                  color: clickable ? 'var(--accent-2)' : 'var(--ink-dim)',
                  cursor: clickable ? 'pointer' : 'default',
                  maxWidth: 180,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.title}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
