import type { CSSProperties } from 'react';

export interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  delta?: string;
  pos?: boolean;
}

export function KpiCard({ label, value, sub, delta, pos }: KpiCardProps) {
  return (
    <div style={CARD}>
      <div style={LABEL}>{label}</div>
      <div style={VALUE}>{value}</div>
      {sub && <div style={SUB}>{sub}</div>}
      {delta && (
        <div style={{ ...DELTA, color: pos ? 'var(--pos)' : 'var(--neg)' }}>
          {pos ? '▲' : '▼'} {delta}
        </div>
      )}
    </div>
  );
}

const CARD: CSSProperties = {
  background: 'var(--bg-paper)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const LABEL: CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.10em',
  color: 'var(--fg-3)',
  fontWeight: 500,
};

const VALUE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 26,
  fontWeight: 400,
  letterSpacing: '-0.02em',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.05,
  color: 'var(--fg)',
};

const SUB: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-3)',
};

const DELTA: CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 3,
};
