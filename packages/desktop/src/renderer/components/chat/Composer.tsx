// SP1 chat — message composer (multimedia-chat-sp1-plan §7).
//
// textarea + Send + RAG toggle. Send is disabled when the input is empty OR when
// two streams are already active (hard-reject-at-2 — the cap is also enforced in
// the main handler; this is the matching renderer affordance, Decision 3). RAG
// toggle defaults ON and is owned by ChatView (lifted state). Sized to fit the
// right panel (280–800px) — a single-column stack, no horizontal overflow.

import { useCallback } from 'react';
import { useT } from '../../lib/i18n.js';

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  /** True when this view already has 2 in-flight streams (cap reached). */
  atCap: boolean;
  ragOn: boolean;
  onRagToggle: (on: boolean) => void;
  /** Agent mode (SP-E): let the model call vault tools + propose confirm-gated writes. */
  agentOn?: boolean;
  onAgentToggle?: (on: boolean) => void;
  /** Auto-distill (SP-I): after each answer, fold the conversation into the wiki. */
  autoDistill?: boolean;
  onAutoDistillToggle?: (on: boolean) => void;
  /** 'panel' = narrow right-panel sizing; 'main' = roomy centered main-view sizing. */
  variant?: 'panel' | 'main';
}

export function Composer({ value, onChange, onSend, atCap, ragOn, onRagToggle, agentOn, onAgentToggle, autoDistill, onAutoDistillToggle, variant = 'panel' }: ComposerProps) {
  const t = useT();
  const canSend = value.trim().length > 0 && !atCap;
  const isMain = variant === 'main';

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter inserts a newline.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (value.trim().length > 0 && !atCap) onSend();
      }
    },
    [value, atCap, onSend],
  );

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        // main: full-width bar, inner column centered below
        padding: isMain ? '12px 16px 16px' : 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'var(--bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: isMain ? 768 : undefined, margin: isMain ? '0 auto' : undefined, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('panel.ai.chatPlaceholder')}
          aria-label={t('panel.ai.chatPlaceholder')}
          rows={isMain ? 3 : 2}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--hover)',
            border: '1px solid var(--border)',
            borderRadius: isMain ? 12 : 6,
            padding: isMain ? '12px 14px' : '8px 10px',
            fontSize: isMain ? 14 : 12.5,
            color: 'var(--ink)',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'inherit',
            lineHeight: 1.5,
            minHeight: isMain ? 52 : 38,
            maxHeight: isMain ? 220 : 160,
            boxShadow: isMain ? '0 1px 3px rgba(0,0,0,0.04)' : undefined,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: isMain ? 12 : 10.5,
              color: 'var(--ink-dim)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
            title={t('panel.ai.ragToggle')}
          >
            <input
              type="checkbox"
              checked={ragOn}
              onChange={(e) => onRagToggle(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            {t('panel.ai.ragLabel')}
          </label>
          {onAgentToggle && (
            <label
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: isMain ? 12 : 10.5,
                color: agentOn ? 'var(--accent-2)' : 'var(--ink-dim)',
                cursor: 'pointer', userSelect: 'none', fontWeight: agentOn ? 600 : 400,
              }}
              title={t('panel.ai.agentHint')}
            >
              <input type="checkbox" checked={!!agentOn} onChange={(e) => onAgentToggle(e.target.checked)} style={{ cursor: 'pointer' }} />
              🤖 {t('panel.ai.agentLabel')}
            </label>
          )}
          {onAutoDistillToggle && (
            <label
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: isMain ? 12 : 10.5,
                color: autoDistill ? 'var(--accent-2)' : 'var(--ink-dim)',
                cursor: 'pointer', userSelect: 'none', fontWeight: autoDistill ? 600 : 400,
              }}
              title={t('panel.ai.autoDistillHint')}
            >
              <input type="checkbox" checked={!!autoDistill} onChange={(e) => onAutoDistillToggle(e.target.checked)} style={{ cursor: 'pointer' }} />
              🗂 {t('panel.ai.autoDistillLabel')}
            </label>
          )}
          <button
            onClick={() => { if (canSend) onSend(); }}
            disabled={!canSend}
            style={{
              marginLeft: 'auto',
              padding: isMain ? '8px 22px' : '6px 16px',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: isMain ? 8 : 6,
              color: '#fff',
              fontSize: isMain ? 13 : 11,
              fontWeight: isMain ? 600 : 400,
              cursor: canSend ? 'pointer' : 'default',
              opacity: canSend ? 1 : 0.5,
            }}
          >
            {t('panel.ai.sendButton')}
          </button>
        </div>
      </div>
      {/* The cap note is owned by ChatView (capMessage), shown once on the genuine
          main-handler rejection — not duplicated here. Send is simply disabled. */}
    </div>
  );
}
