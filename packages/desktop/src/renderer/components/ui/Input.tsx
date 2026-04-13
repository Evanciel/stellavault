// Shared Input primitive with built-in label/aria support.

import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, id, style, ...props }: InputProps) {
  const inputId = id ?? (label ? `sv-input-${label.replace(/\s/g, '-').toLowerCase()}` : undefined);

  return (
    <>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: '10px', color: 'var(--ink-faint)', marginBottom: 3, display: 'block' }}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-label={label ?? props['aria-label'] ?? props.placeholder}
        {...props}
        style={{
          width: '100%',
          background: 'var(--hover)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '5px 8px',
          fontSize: '11px',
          color: 'var(--ink)',
          outline: 'none',
          fontFamily: 'inherit',
          ...style,
        }}
      />
    </>
  );
}
