// Lightweight, reactive renderer i18n (KO/EN). No dependency — wired to the Zustand
// settings store so changing `settings.language` re-renders every useT() consumer.
// Phased: keys are added per surface. Untranslated strings simply stay English.
// (Phase 1a: capture UI + status bar + the language setting itself. AppMenu / commands
//  / the rest of Settings are Phase 1b.)

import { useSettingsStore } from '../stores/settings-store.js';

export type Lang = 'en' | 'ko';
interface Entry { en: string; ko: string }

export const messages = {
  // ── common ──
  'common.skip':   { en: 'Skip',   ko: '건너뛰기' },

  // ── settings ──
  'settings.language':      { en: 'Language',          ko: '언어' },
  'settings.language.hint': { en: 'Interface language (Korean coverage is rolling out).', ko: '인터페이스 언어 (한국어 적용 범위는 점차 확대 중).' },

  // ── capture inbox ──
  'capture.hint':          { en: 'Drop files or links anywhere — they’re extracted, classified, and filed automatically.', ko: '파일이나 링크를 아무 데나 끌어다 놓으면 자동으로 추출·분류·정리됩니다.' },
  'capture.pasteLink':     { en: 'Paste link', ko: '링크 붙여넣기' },
  'capture.pause':         { en: '⏸ Pause',  ko: '⏸ 일시정지' },
  'capture.resume':        { en: '▶ Resume', ko: '▶ 재개' },
  'capture.empty':         { en: 'Nothing captured yet.', ko: '아직 캡처된 항목이 없습니다.' },
  'capture.dropToCapture': { en: '📥 Drop to capture into your vault', ko: '📥 놓으면 볼트에 캡처됩니다' },
  'capture.status.queued':     { en: 'queued',  ko: '대기' },
  'capture.status.processing': { en: 'working', ko: '처리중' },
  'capture.status.done':       { en: 'filed',   ko: '완료' },
  'capture.status.rejected':   { en: 'failed',  ko: '실패' },
  'capture.status.duplicate':  { en: 'dup',     ko: '중복' },
  'capture.review':            { en: 'review',  ko: '검토' },

  // ── review queue ──
  'review.empty':        { en: '🎉 Inbox zero — nothing to review.', ko: '🎉 검토할 항목이 없습니다.' },
  'review.needCategory': { en: '{n} item(s) need a category.', ko: '{n}개 항목에 분류가 필요합니다.' },
  'review.noMatch':      { en: 'No category match yet.', ko: '아직 일치하는 카테고리가 없습니다.' },

  // ── category browser ──
  'category.empty': { en: 'No categories yet — they emerge as you capture.', ko: '아직 카테고리가 없습니다 — 캡처할수록 자동으로 생깁니다.' },

  // ── status bar ──
  'status.noVault':      { en: 'No vault',  ko: '볼트 없음' },
  'status.wordsChars':   { en: '{words} words · {chars} chars', ko: '{words} 단어 · {chars} 자' },
  'status.modified':     { en: 'Modified',  ko: '수정됨' },
  'status.aiReady':      { en: 'AI ready',  ko: 'AI 준비됨' },
  'status.aiLoading':    { en: 'Loading AI...', ko: 'AI 로딩 중...' },
  'status.capture':      { en: 'capture',   ko: '캡처' },
  'status.captureInbox': { en: 'Capture inbox', ko: '캡처 받은함' },
  'status.reviewQueue':  { en: 'Review queue',  ko: '검토 대기열' },
} satisfies Record<string, Entry>;

export type MsgKey = keyof typeof messages;

function render(key: MsgKey, lang: Lang, vars?: Record<string, string | number>): string {
  const entry = messages[key];
  let s = entry ? (entry[lang] ?? entry.en) : (key as string);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

/** Non-reactive lookup — for event-time callers (command run() bodies, etc.). */
export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  return render(key, useSettingsStore.getState().settings.language ?? 'en', vars);
}

/** Reactive hook — components re-render when settings.language changes. */
export function useT(): (key: MsgKey, vars?: Record<string, string | number>) => string {
  const lang = useSettingsStore((s) => s.settings.language ?? 'en');
  return (key, vars) => render(key, lang, vars);
}
