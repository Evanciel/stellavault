// T3-5: ADR / decision capture modal. Collects the structured fields the core
// decision-journal records (title, context, decision, alternatives, reasoning,
// project) and writes them via the 'decision:log' IPC → <vault>/decisions/.
//
// Matches the user's ADR-centric workflow (global CLAUDE.md auto-ADR): "decision
// + rationale + alternatives". On save we open the new file so the user can
// refine it, and the vault tree refreshes (the decisions/ folder may be new).

import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal.js';
import { ipc } from '../../lib/ipc-client.js';
import { showToast } from '../../lib/toast.js';
import { useAppStore } from '../../stores/app-store.js';
import { useDecisionsUi } from './decisions-store.js';
import { useT } from '../../lib/i18n.js';

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--hover)',
  border: '1px solid var(--border)', borderRadius: 4, padding: '7px 10px',
  fontSize: 12, color: 'var(--ink)', outline: 'none',
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--ink-dim)', marginBottom: 4, display: 'block',
};

export function DecisionCaptureModal() {
  const t = useT();
  const open = useDecisionsUi((s) => s.captureOpen);
  const prefill = useDecisionsUi((s) => s.capturePrefillTitle);
  const close = useDecisionsUi((s) => s.closeCapture);
  const openFile = useAppStore((s) => s.openFile);

  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [decision, setDecision] = useState('');
  const [alternatives, setAlternatives] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [project, setProject] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset fields each time the modal opens (seed title from the prefill).
  useEffect(() => {
    if (open) {
      setTitle(prefill);
      setContext(''); setDecision(''); setAlternatives(''); setReasoning(''); setProject('');
      setSaving(false);
    }
  }, [open, prefill]);

  const canSave = title.trim() && decision.trim() && reasoning.trim() && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await ipc('decision:log', {
        title: title.trim(),
        context: context.trim() || undefined,
        decision: decision.trim(),
        alternatives: alternatives
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
        reasoning: reasoning.trim(),
        project: project.trim() || undefined,
      });
      showToast('Decision logged', 'success');
      close();
      // Refresh the tree (decisions/ may be brand new) and open the file.
      try {
        const tree = await ipc('vault:read-tree');
        useAppStore.getState().setFileTree(tree);
      } catch { /* tree refresh is best-effort */ }
      if (res.filePath) {
        try {
          const content = await ipc('vault:read-file', res.filePath);
          openFile(res.filePath, title.trim(), content);
        } catch { /* file open is best-effort */ }
      }
    } catch (err) {
      console.error('[decisions] log failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Decision log failed — ${msg}`, 'error', 0);
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title={t('decisions.captureTitle')} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle}>{t('decisions.fieldTitle')}</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('decisions.titlePlaceholder')}
            aria-label="Decision title"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('decisions.fieldContext')}</label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder={t('decisions.contextPlaceholder')}
            aria-label="Decision context"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('decisions.fieldDecision')}</label>
          <textarea
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            placeholder={t('decisions.decisionPlaceholder')}
            aria-label="Decision"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('decisions.fieldAlternatives')}</label>
          <textarea
            value={alternatives}
            onChange={(e) => setAlternatives(e.target.value)}
            placeholder={t('decisions.alternativesPlaceholder')}
            aria-label="Alternatives considered"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('decisions.fieldReasoning')}</label>
          <textarea
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            placeholder={t('decisions.reasoningPlaceholder')}
            aria-label="Reasoning"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('decisions.fieldProject')}</label>
          <input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder={t('decisions.projectPlaceholder')}
            aria-label="Project"
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            onClick={close}
            style={{ padding: '6px 14px', background: 'var(--hover)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--ink-dim)', cursor: 'pointer', fontSize: 12 }}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!canSave}
            style={{
              padding: '6px 14px', background: 'var(--accent)', border: 'none', borderRadius: 4,
              color: '#fff', cursor: canSave ? 'pointer' : 'default', fontSize: 12, opacity: canSave ? 1 : 0.5,
            }}
          >
            {saving ? t('decisions.saving') : t('decisions.logButton')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
