// Synthesis Panel (T3-1) — the flagship AI differentiator.
//
// Type a topic (or pull the current note's title), and core compiles a cited
// article from your own vault: search → gather sources → synthesize. With an AI
// provider key configured (Settings → AI), the article is LLM-synthesized prose
// citing [[Note]] backlinks; without one it degrades to an extractive outline —
// still cited, always works. [[backlinks]] in the article are clickable and reuse
// the editor's wikilink open/create (openWikilinkTarget).
//
// Wires the dormant core compile/synthesis engines (compileWiki/extractConcepts
// underpin the engine; askVault's pluggable Synthesizer drives the LLM path) via
// the additive 'core:synthesize' IPC channel.

import { useState, useCallback, Fragment } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { invokeIpcRaw } from '../../lib/runtime-sync.js';
import { registerCommand } from '../../lib/commands.js';
import { openWikilinkTarget } from '../editor/WikilinkNode.js';
import { useT } from '../../lib/i18n.js';
import type { SynthesisResult } from '../../../shared/ipc-types.js';

// Palette command + default hotkey (mirrors AIPanel / CoachPanel registration).
let synthesisCommandsRegistered = false;
function registerSynthesisCommands(): void {
  if (synthesisCommandsRegistered) return;
  synthesisCommandsRegistered = true;
  registerCommand({
    id: 'panel.synthesis', title: 'Synthesize an article (Wiki)', category: 'Panels',
    defaultKeys: 'mod+shift+y',
    run: () => useAppStore.getState().setRightPanel('synthesis'),
  });
}
registerSynthesisCommands();

/** Render markdown text, turning [[Title]] / [[Title|alias]] into clickable spans
 *  that open the note (reusing the editor's wikilink open/create). Everything else
 *  renders as preformatted text — the article is markdown, shown verbatim. */
function ArticleBody({ article }: { article: string }) {
  // Split on wikilink tokens, keeping the tokens. Non-greedy, no nesting/newlines.
  const parts = article.split(/(\[\[[^\][\n]+?\]\])/g);
  return (
    <pre
      style={{
        whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, padding: 12,
        background: 'var(--hover)', border: '1px solid var(--border)', borderRadius: 6,
        fontSize: 12, lineHeight: 1.65, color: 'var(--ink)',
      }}
    >
      {parts.map((part, i) => {
        const m = part.match(/^\[\[([^\][\n]+?)\]\]$/);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const inner = m[1];
        const pipe = inner.indexOf('|');
        const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
        const label = (pipe === -1 ? inner : inner.slice(pipe + 1)).trim();
        return (
          <span
            key={i}
            role="link"
            tabIndex={0}
            onClick={() => void openWikilinkTarget(target)}
            onKeyDown={(e) => { if (e.key === 'Enter') void openWikilinkTarget(target); }}
            title={`Open [[${target}]]`}
            style={{ color: 'var(--accent-2)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {label}
          </span>
        );
      })}
    </pre>
  );
}

export function SynthesisPanel() {
  const t = useT();
  const coreReady = useAppStore((s) => s.coreReady);
  const openFile = useAppStore((s) => s.openFile);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);

  const [topic, setTopic] = useState('');
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSynthesize = useCallback(async (t: string) => {
    const q = t.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await invokeIpcRaw<SynthesisResult>('core:synthesize', q);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Synthesis failed. Is the vault indexed?');
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const useCurrentNote = useCallback(() => {
    const active = tabs.find((t) => t.id === activeTabId);
    if (!active) return;
    setTopic(active.title);
    void handleSynthesize(active.title);
  }, [tabs, activeTabId, handleSynthesize]);

  // Save the synthesized article into the vault as a new note (under _synthesis/).
  const saveArticle = useCallback(async () => {
    if (!result?.article) return;
    const safeName = (result.topic || 'article').replace(/[<>:"/\\|?*]/g, '').slice(0, 80) || 'article';
    const vp = await invokeIpcRaw<string>('vault:get-path');
    const path = `${vp.replace(/[\\/]+$/, '')}/_synthesis/${safeName}.md`;
    await invokeIpcRaw<void>('vault:create-file', path, result.article);
    openFile(path, safeName, result.article);
  }, [result, openFile]);

  if (!coreReady) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
        <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>&#x2726;</div>
        {t('panel.synthesis.loading')}
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
        {t('panel.synthesis.title')}
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 12, lineHeight: 1.5 }}>
        {t('panel.synthesis.description')}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSynthesize(topic); }}
          placeholder={t('panel.synthesis.placeholder')}
          aria-label={t('panel.synthesis.placeholder')}
          style={{
            flex: 1, background: 'var(--hover)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '6px 10px', fontSize: 12, color: 'var(--ink)', outline: 'none',
          }}
        />
        <button
          onClick={() => void handleSynthesize(topic)}
          disabled={loading || !topic.trim()}
          style={{
            padding: '6px 14px', background: 'var(--accent)', border: 'none', borderRadius: 4,
            color: '#fff', fontSize: 11, cursor: 'pointer', opacity: loading || !topic.trim() ? 0.5 : 1,
          }}
        >
          {loading ? '...' : t('panel.synthesis.compileButton')}
        </button>
      </div>

      <button
        onClick={useCurrentNote}
        disabled={loading || !activeTabId}
        style={{
          width: '100%', padding: '5px', marginBottom: 12, fontSize: 10, cursor: 'pointer',
          background: 'transparent', border: '1px solid var(--border)', borderRadius: 4,
          color: 'var(--ink-dim)', opacity: loading || !activeTabId ? 0.5 : 1,
        }}
      >
        {t('panel.synthesis.useCurrentNoteButton')}
      </button>

      {loading && (
        <div aria-label="Synthesizing">
          {[100, 94, 88, 70].map((w, i) => (
            <div key={i} style={{
              height: 10, width: `${w}%`, marginBottom: 8, borderRadius: 4,
              background: 'var(--hover)', opacity: 0.8 - i * 0.15,
            }} />
          ))}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: 'var(--ink-dim)', padding: 10, background: 'var(--hover)', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {result && !loading && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 3, color: '#fff',
              background: result.synthesized ? 'var(--accent)' : 'var(--ink-faint)',
            }}>
              {result.synthesized ? t('panel.synthesis.aiSynthesized') : t('panel.synthesis.extractive')}
            </span>
            <span style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
              {t('panel.synthesis.sourceCount', { count: result.sources.length })}
            </span>
            <button
              onClick={() => void saveArticle()}
              disabled={!result.article}
              style={{
                marginLeft: 'auto', padding: '3px 10px', fontSize: 10, cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--ink-dim)',
              }}
            >
              {t('panel.synthesis.saveButton')}
            </button>
          </div>

          <ArticleBody article={result.article} />

          {!result.synthesized && (
            <div style={{ fontSize: 9, color: 'var(--ink-faint)', marginTop: 8, lineHeight: 1.5 }}>
              {t('panel.synthesis.noAiHint')}
            </div>
          )}
        </div>
      )}

      {!result && !loading && !error && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
          {t('panel.synthesis.emptyHint')}
        </div>
      )}
    </div>
  );
}
