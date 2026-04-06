// 첫 방문 사용자를 위한 온보딩 가이드 오버레이
import { useState, useEffect } from 'react';
import { useGraphStore } from '../stores/graph-store.js';
import { getTheme } from '../lib/theme.js';

const ONBOARDING_KEY = 'sv_onboarding_done';

export function OnboardingGuide() {
  const themeMode = useGraphStore((s) => s.theme);
  const nodes = useGraphStore((s) => s.nodes);
  const t = getTheme(themeMode);
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
      title: 'Welcome to Stellavault',
      body: nodes.length > 0
        ? `Your vault has ${nodes.length} documents visualized as a neural network. Drag to rotate, scroll to zoom.`
        : 'Your vault is empty. Run `stellavault index /path/to/vault` in terminal first.',
    },
    {
      title: 'Search by Meaning',
      body: 'Use the search bar (or press /) to find notes by meaning, not just keywords. Matching nodes will pulse.',
    },
    {
      title: 'Add Knowledge',
      body: 'Click the + button (bottom-right) to paste URLs, text, or ideas. They\'re auto-saved to your vault.',
    },
    {
      title: 'Explore Features',
      body: 'Try: Heatmap (activity), Gaps (missing links), Timeline (history), Decay (fading memory). Click Intelligence for health dashboard.',
    },
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
        background: t.bgSolid,
        border: `1px solid ${t.borderActive}`,
        borderRadius: '16px',
        padding: '28px 32px',
        maxWidth: '420px',
        width: '90%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontSize: '10px', color: t.textDim, marginBottom: '4px' }}>
          {step + 1} / {steps.length}
        </div>
        <h3 style={{ color: t.text, margin: '0 0 12px', fontSize: '18px', fontWeight: 700 }}>
          {current.title}
        </h3>
        <p style={{ color: t.textMuted, fontSize: '13px', lineHeight: 1.6, margin: '0 0 20px' }}>
          {current.body}
        </p>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={dismiss}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: `1px solid ${t.buttonBorder}`,
              borderRadius: '8px',
              color: t.textMuted,
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Skip
          </button>
          <button
            onClick={() => step < steps.length - 1 ? setStep(step + 1) : dismiss()}
            style={{
              padding: '8px 20px',
              background: t.buttonActive,
              border: `1px solid ${t.borderActive}`,
              borderRadius: '8px',
              color: t.text,
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {step < steps.length - 1 ? 'Next' : 'Get Started'}
          </button>
        </div>
      </div>
    </div>
  );
}
