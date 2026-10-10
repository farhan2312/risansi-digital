'use client';

import { useEffect, type CSSProperties } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type: ToastKind;
  onDismiss: () => void;
}

export function Toast({ message, type, onDismiss }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const borderColor =
    type === 'success' ? '#0E9F6E' : type === 'error' ? '#E02424' : '#1A5CB8';
  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';

  return (
    <div style={wrap(borderColor)}>
      <span style={{ color: borderColor, fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ flex: 1, color: '#0D1B2A' }}>{message}</span>
      <button type="button" onClick={onDismiss} style={CLOSE}>×</button>
    </div>
  );
}

const wrap = (borderColor: string): CSSProperties => ({
  position:     'fixed',
  bottom:       24,
  right:        24,
  zIndex:       9999,
  background:   '#ffffff',
  border:       '1px solid #DDE6F5',
  borderLeft:   `4px solid ${borderColor}`,
  borderRadius: 8,
  padding:      '14px 16px',
  boxShadow:    '0 4px 16px rgba(10,61,143,0.12)',
  minWidth:     280,
  fontSize:     13,
  display:      'flex',
  alignItems:   'center',
  gap:          10,
});

const CLOSE: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: '#6B7FA3', fontSize: 18, padding: 0,
  lineHeight: 1, flexShrink: 0,
};
