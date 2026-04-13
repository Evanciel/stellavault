// Shared Button primitive — replaces 30+ inline button styles across the app.

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: boolean;
  active?: boolean;
  children: ReactNode;
}

const variantStyles: Record<Variant, React.CSSProperties> = {
  default: {
    background: 'var(--hover)',
    border: '1px solid var(--border)',
    color: 'var(--ink-dim)',
  },
  primary: {
    background: 'var(--accent)',
    border: '1px solid var(--accent)',
    color: '#fff',
  },
  ghost: {
    background: 'transparent',
    border: 'none',
    color: 'var(--ink-dim)',
  },
  danger: {
    background: 'transparent',
    border: '1px solid rgba(239,68,68,0.3)',
    color: '#ef4444',
  },
};

export function Button({
  variant = 'default',
  size = 'sm',
  icon = false,
  active = false,
  children,
  style,
  ...props
}: ButtonProps) {
  const base = variantStyles[variant];
  const sizeStyles: React.CSSProperties = size === 'sm'
    ? { padding: icon ? '4px 6px' : '4px 10px', fontSize: '11px' }
    : { padding: icon ? '6px 8px' : '6px 14px', fontSize: '12px' };

  return (
    <button
      {...props}
      style={{
        ...base,
        ...sizeStyles,
        borderRadius: 4,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'inherit',
        lineHeight: 1,
        transition: 'all 0.15s',
        opacity: props.disabled ? 0.5 : 1,
        ...(active ? { background: 'var(--selection)', color: 'var(--accent-2)' } : {}),
        ...style,
      }}
    >
      {children}
    </button>
  );
}
