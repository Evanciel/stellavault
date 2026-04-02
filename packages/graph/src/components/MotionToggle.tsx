// 모션 ON/OFF 토글 버튼

interface Props {
  active: boolean;
  loading: boolean;
  onToggle: () => void;
  isDark?: boolean;
}

export function MotionToggle({ active, loading, onToggle, isDark = true }: Props) {
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      style={{
        padding: '4px 10px',
        fontSize: '11px',
        border: `1px solid ${isDark ? 'rgba(100,120,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
        borderRadius: '4px',
        cursor: loading ? 'wait' : 'pointer',
        background: active
          ? (isDark ? 'rgba(100,255,120,0.2)' : 'rgba(40,160,80,0.1)')
          : (isDark ? 'rgba(100,120,255,0.06)' : 'rgba(0,0,0,0.03)'),
        color: active
          ? (isDark ? '#88ff88' : '#2a8a4a')
          : (isDark ? '#aab' : '#555'),
        transition: 'all 0.2s',
      }}
    >
      {loading ? 'Loading...' : active ? '✋ Motion ON' : '✋ Motion'}
    </button>
  );
}
