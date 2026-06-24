// SP1 chat — message composer (multimedia-chat-sp1-plan §7).
//
// textarea + Send + RAG toggle. Send is disabled when the input is empty OR when
// two streams are already active (hard-reject-at-2 — the cap is also enforced in
// the main handler; this is the matching renderer affordance, Decision 3). RAG
// toggle defaults ON and is owned by ChatView (lifted state). Sized to fit the
// right panel (280–800px) — a single-column stack, no horizontal overflow.

import { useCallback, useRef, useState, useEffect } from 'react';
import { useT } from '../../lib/i18n.js';
import { parseSlash, matchCommands, applyTemplate, topQuickBar, bumpFreq, type SlashCommand, type CommandCtx } from './commands.js';

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
  /** SP2/SP4 attachments staged for the next send (image dataUrl OR audio/video transcript). */
  attachments?: Array<{ id: string; type: 'image' | 'audio' | 'video'; fileName: string; dataUrl?: string; transcript?: string }>;
  onPickImages?: () => void;
  onRemoveAttachment?: (id: string) => void;
  /** The active model advertises 'vision' — gates the 📎 image affordance. */
  visionOn?: boolean;
  pickingImages?: boolean;
  /** SP4: pick audio/video (gated on the dedicated cloud key being set). */
  onPickMedia?: (kind: 'audio' | 'video') => void;
  transcribeOn?: boolean; // OpenAI Whisper key set → 🎤
  videoOn?: boolean;      // Gemini key set → 🎬
  pickingMedia?: boolean;
  /** Part4: slash commands + quick-bar. Both call onCommand; absent → feature off. */
  onCommand?: (cmd: SlashCommand, arg: string) => void;
  commandCtx?: CommandCtx;
  /** 'panel' = narrow right-panel sizing; 'main' = roomy centered main-view sizing. */
  variant?: 'panel' | 'main';
}

export function Composer({ value, onChange, onSend, atCap, ragOn, onRagToggle, agentOn, onAgentToggle, autoDistill, onAutoDistillToggle, attachments, onPickImages, onRemoveAttachment, visionOn, pickingImages, onPickMedia, transcribeOn, videoOn, pickingMedia, onCommand, commandCtx, variant = 'panel' }: ComposerProps) {
  const t = useT();
  const atts = attachments ?? [];
  const canSend = (value.trim().length > 0 || atts.length > 0) && !atCap;
  const isMain = variant === 'main';

  // Part4: slash-command menu + quick-bar. Both invoke onCommand (single dispatch in ChatView).
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cmdsOn = !!(onCommand && commandCtx);
  const slash = cmdsOn ? parseSlash(value) : { isSlash: false, token: '', arg: '' };
  const matches = cmdsOn && slash.isSlash ? matchCommands(slash.token, commandCtx!) : [];
  const [dismissed, setDismissed] = useState(false); // Esc closed the menu but kept the text
  const menuOpen = cmdsOn && slash.isSlash && matches.length > 0 && !dismissed;
  const [activeIdx, setActiveIdx] = useState(0);
  const clampIdx = (i: number) => (matches.length ? ((i % matches.length) + matches.length) % matches.length : 0);
  // Reset the highlight to the top whenever the filtered set changes (so it never points at a
  // now-narrowed row — the user expects Enter to hit the first visible result).
  useEffect(() => { setActiveIdx(0); }, [slash.token, matches.length]);

  const pick = useCallback((cmd: SlashCommand) => {
    if (!onCommand) return;
    onCommand(cmd, slash.arg);
    bumpFreq(cmd.id);
    // prefill keeps its filled text; toggles/runs clear the typed "/command".
    if (cmd.action !== 'prefill' && cmd.action !== 'send') onChange('');
    setActiveIdx(0);
    textareaRef.current?.focus();
  }, [onCommand, slash.arg, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Slash menu owns the keys FIRST (so Enter picks-not-sends); plain Enter still sends below.
      if (menuOpen) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => clampIdx(i + 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => clampIdx(i - 1)); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const cmd = matches[clampIdx(activeIdx)]; if (cmd) pick(cmd); return; }
        if (e.key === 'Escape') { e.preventDefault(); setDismissed(true); return; }
      }
      // Enter sends; Shift+Enter inserts a newline.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if ((value.trim().length > 0 || atts.length > 0) && !atCap) onSend();
      }
    },
    [menuOpen, matches, activeIdx, pick, value, atCap, onSend, atts.length],
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
      <div style={{ position: 'relative', width: '100%', maxWidth: isMain ? 768 : undefined, margin: isMain ? '0 auto' : undefined, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Part4: slash-command popover — absolutely positioned above the composer column. */}
        {menuOpen && (
          <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.18)', maxHeight: 240, overflowY: 'auto', zIndex: 30, padding: 4 }}>
            {matches.map((cmd, i) => (
              <div key={cmd.id}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(cmd); }}
                style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '6px 10px', borderRadius: 7, cursor: 'pointer', background: i === clampIdx(activeIdx) ? 'var(--hover)' : 'transparent' }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>/{cmd.id}{cmd.takesArg ? ' …' : ''} <span style={{ fontWeight: 400, color: 'var(--ink)' }}>{t(cmd.titleKey as never)}</span></span>
                <span style={{ fontSize: 10.5, color: 'var(--ink-dim)' }}>{t(cmd.descKey as never)}</span>
              </div>
            ))}
          </div>
        )}
        {atts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {atts.map((a) => (
              a.type === 'image' ? (
                <div key={a.id} title={a.fileName} style={{ position: 'relative', width: 52, height: 52, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
                  <img src={a.dataUrl} alt={a.fileName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button onClick={() => onRemoveAttachment?.(a.id)} aria-label={t('panel.ai.attachRemove')} style={{ position: 'absolute', top: 1, right: 1, width: 16, height: 16, lineHeight: '14px', padding: 0, borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, cursor: 'pointer' }}>×</button>
                </div>
              ) : (
                // SP4 audio/video chip — transcript already attached (shown in the bubble on send).
                <div key={a.id} title={a.transcript || a.fileName} style={{ position: 'relative', maxWidth: 200, display: 'flex', alignItems: 'center', gap: 5, padding: '6px 24px 6px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--hover)', fontSize: 11, color: 'var(--ink-dim)' }}>
                  <span>{a.type === 'audio' ? '🎵' : '🎬'}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fileName}</span>
                  <button onClick={() => onRemoveAttachment?.(a.id)} aria-label={t('panel.ai.attachRemove')} style={{ position: 'absolute', top: 1, right: 1, width: 16, height: 16, lineHeight: '14px', padding: 0, borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 11, cursor: 'pointer' }}>×</button>
                </div>
              )
            ))}
          </div>
        )}
        {/* Part4: quick-action bar — pinned frequent commands as pills (hidden while typing "/"). */}
        {cmdsOn && !slash.isSlash && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {topQuickBar(commandCtx!).map((cmd) => (
              <button key={cmd.id} onClick={() => pick(cmd)} title={t(cmd.descKey as never)}
                style={{ padding: '5px 11px', borderRadius: 16, border: '1px solid var(--border)', background: 'transparent', color: 'var(--ink-dim)', fontSize: 11.5, cursor: 'pointer', transition: 'border-color 120ms, color 120ms' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--ink)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--ink-dim)'; }}
              >{t(cmd.titleKey as never)}</button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { setDismissed(false); onChange(e.target.value); }}
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
          {visionOn && onPickImages && (
            <button
              onClick={() => { if (!pickingImages) onPickImages(); }}
              disabled={pickingImages}
              title={t('panel.ai.attachHint')}
              aria-label={t('panel.ai.attachLabel')}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: isMain ? '5px 10px' : '4px 8px',
                background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
                color: 'var(--ink-dim)', fontSize: isMain ? 12 : 10.5,
                cursor: pickingImages ? 'default' : 'pointer', opacity: pickingImages ? 0.5 : 1,
              }}
            >
              📎 {t('panel.ai.attachLabel')}
            </button>
          )}
          {transcribeOn && onPickMedia && (
            <button onClick={() => { if (!pickingMedia) onPickMedia('audio'); }} disabled={pickingMedia}
              title={t('panel.ai.audioHint')} aria-label={t('panel.ai.audioLabel')}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: isMain ? '5px 10px' : '4px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--ink-dim)', fontSize: isMain ? 12 : 10.5, cursor: pickingMedia ? 'default' : 'pointer', opacity: pickingMedia ? 0.5 : 1 }}>
              🎤 {t('panel.ai.audioLabel')}
            </button>
          )}
          {videoOn && onPickMedia && (
            <button onClick={() => { if (!pickingMedia) onPickMedia('video'); }} disabled={pickingMedia}
              title={t('panel.ai.videoHint')} aria-label={t('panel.ai.videoLabel')}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: isMain ? '5px 10px' : '4px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--ink-dim)', fontSize: isMain ? 12 : 10.5, cursor: pickingMedia ? 'default' : 'pointer', opacity: pickingMedia ? 0.5 : 1 }}>
              🎬 {t('panel.ai.videoLabel')}
            </button>
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
