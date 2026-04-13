// Modal primitive — replaces prompt()/alert()/confirm() which freeze Electron.

import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: number;
}

export function Modal({ open, onClose, title, children, width = 420 }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 10000,
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '18vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxHeight: '60vh',
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {title && (
          <div style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--ink-faint)',
                cursor: 'pointer',
                fontSize: 16,
                padding: '2px 6px',
              }}
            >
              &#x2715;
            </button>
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Prompt replacement ───

interface PromptModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title: string;
  placeholder?: string;
  defaultValue?: string;
}

export function PromptModal({ open, onClose, onSubmit, title, placeholder, defaultValue = '' }: PromptModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  function handleSubmit() {
    const val = inputRef.current?.value.trim();
    if (val) { onSubmit(val); onClose(); }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} width={380}>
      <input
        ref={inputRef}
        type="text"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={title}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        style={{
          width: '100%',
          background: 'var(--hover)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '8px 12px',
          fontSize: 13,
          color: 'var(--ink)',
          outline: 'none',
          marginBottom: 12,
        }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ padding: '6px 14px', background: 'var(--hover)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--ink-dim)', cursor: 'pointer', fontSize: 12 }}>
          Cancel
        </button>
        <button onClick={handleSubmit} style={{ padding: '6px 14px', background: 'var(--accent)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12 }}>
          Create
        </button>
      </div>
    </Modal>
  );
}

// ─── Confirm replacement ───

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger = false }: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} width={360}>
      <p style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6, marginBottom: 16 }}>{message}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ padding: '6px 14px', background: 'var(--hover)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--ink-dim)', cursor: 'pointer', fontSize: 12 }}>
          Cancel
        </button>
        <button onClick={() => { onConfirm(); onClose(); }} style={{
          padding: '6px 14px',
          background: danger ? '#ef4444' : 'var(--accent)',
          border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12,
        }}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
