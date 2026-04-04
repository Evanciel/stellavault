// Design Ref: Polish 4 — 테마 디자인 토큰
// 인라인 색상을 상수로 추출하여 일관된 테마 관리

export const THEME = {
  dark: {
    bg: 'rgba(10, 10, 20, 0.8)',
    bgSolid: 'rgba(10, 10, 20, 0.95)',
    border: 'rgba(100, 120, 255, 0.1)',
    borderActive: 'rgba(100, 120, 255, 0.4)',
    text: '#aab',
    textMuted: '#667',
    textDim: '#556',
    textAccent: '#88aaff',
    accent: 'rgba(100, 120, 255, 0.15)',
    accentHover: 'rgba(100, 120, 255, 0.25)',
    buttonBg: 'rgba(100, 120, 255, 0.06)',
    buttonBorder: 'rgba(100, 120, 255, 0.15)',
    buttonActive: 'rgba(100, 120, 255, 0.2)',
    danger: '#ef4444',
    warning: '#f59e0b',
    success: '#10b981',
  },
  light: {
    bg: 'rgba(240, 242, 248, 0.95)',
    bgSolid: 'rgba(240, 242, 248, 0.97)',
    border: 'rgba(0, 0, 0, 0.08)',
    borderActive: 'rgba(0, 0, 0, 0.2)',
    text: '#334',
    textMuted: '#556',
    textDim: '#888',
    textAccent: '#3b82f6',
    accent: 'rgba(0, 0, 0, 0.04)',
    accentHover: 'rgba(0, 0, 0, 0.08)',
    buttonBg: 'rgba(0, 0, 0, 0.03)',
    buttonBorder: 'rgba(0, 0, 0, 0.12)',
    buttonActive: 'rgba(59, 130, 246, 0.15)',
    danger: '#dc2626',
    warning: '#d97706',
    success: '#059669',
  },
} as const;

export type ThemeMode = keyof typeof THEME;

export function getTheme(mode: ThemeMode) {
  return THEME[mode];
}
