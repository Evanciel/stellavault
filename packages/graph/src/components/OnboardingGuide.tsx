// 첫 방문 사용자를 위한 온보딩 가이드 오버레이
import { useState, useEffect } from 'react';
import { useGraphStore } from '../stores/graph-store.js';
import { getTheme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

const ONBOARDING_KEY = 'sv_onboarding_done';

export function OnboardingGuide() {
  const themeMode = useGraphStore((s) => s.theme);
  const nodes = useGraphStore((s) => s.nodes);
  const th = getTheme(themeMode);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (localStorage.getItem(ONBOARDING_KEY)) return;
    // 그래프 로드 후 표시
    const timer = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(ONBOARDING_KEY, 'true');
  };

  if (!visible) return null;

  const steps = [
    {
      title: t('onboard.welcome'),
      body: nodes.length > 0
        ? `${nodes.length} ${t('status.docs')} — ${t('onboard.welcome.body')}`
        : t('onboard.welcome.empty'),
    },
    { title: t('onboard.search'), body: t('onboard.search.body') },
    { title: t('onboard.add'), body: t('onboard.add.body') },
    { title: t('onboard.explore'), body: t('onboard.explore.body') },
  ];

  const current = steps[step];

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 200,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: th.bgSolid,
        border: `1px solid ${th.borderActive}`,
        borderRadius: '16px',
        padding: '28px 32px',
        maxWidth: '420px',
        width: '90%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontSize: '10px', color: th.textDim, marginBottom: '4px' }}>
          {step + 1} / {steps.length}
        </div>
        <h3 style={{ color: th.text, margin: '0 0 12px', fontSize: '18px', fontWeight: 700 }}>
          {current.title}
        </h3>
        <p style={{ color: th.textMuted, fontSize: '13px', lineHeight: 1.6, margin: '0 0 20px' }}>
          {current.body}
        </p>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={dismiss}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: `1px solid ${th.buttonBorder}`,
              borderRadius: '8px',
              color: th.textMuted,
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {t('onboard.skip')}
          </button>
          <button
            onClick={() => step < steps.length - 1 ? setStep(step + 1) : dismiss()}
            style={{
              padding: '8px 20px',
              background: th.buttonActive,
              border: `1px solid ${th.borderActive}`,
              borderRadius: '8px',
              color: th.text,
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {step < steps.length - 1 ? t('onboard.next') : t('onboard.start')}
          </button>
        </div>
      </div>
    </div>
  );
}
