import type { ReactNode, CSSProperties } from 'react';

export type TagKind = 'pos' | 'neg' | 'warn' | 'info' | 'accent';

export interface TagProps {
  kind?:     TagKind;
  dot?:      boolean;
  children?: ReactNode;
}

const KIND_STYLES: Record<TagKind, CSSProperties> = {
  pos:    { background: 'var(--pos-soft)', color: 'var(--pos-strong)', borderColor: 'rgba(5,150,105,0.20)' },
  neg:    { background: 'var(--neg-soft)', color: 'var(--neg-strong)', borderColor: 'rgba(220,38,38,0.20)' },
  warn:   { background: 'var(--warn-soft)', color: 'var(--warn-strong)', borderColor: 'rgba(217,119,6,0.25)' },
  info:   { background: 'var(--info-soft)', color: 'var(--info-strong)', borderColor: 'rgba(37,99,235,0.20)' },
  accent: { background: 'rgba(26,92,184,0.10)', color: 'var(--brand-blue)', borderColor: 'rgba(26,92,184,0.22)' },
};

const BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 6px',
  fontSize: 10,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  borderRadius: 3,
  background: 'var(--bg-sunk)',
  color: 'var(--fg-2)',
  border: '1px solid var(--line)',
  whiteSpace: 'nowrap',
};

export function Tag({ kind, dot, children }: TagProps) {
  const style: CSSProperties = { ...BASE, ...(kind ? KIND_STYLES[kind] : {}) };
  return (
    <span style={style}>
      {dot && (
        <span style={{
          width: 5, height: 5,
          borderRadius: '50%',
          background: 'currentColor',
          display: 'inline-block',
          flexShrink: 0,
        }} />
      )}
      {children}
    </span>
  );
}
