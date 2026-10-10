export type StatusKind = 'active' | 'inactive' | 'prospect' | 'lead' | 'client' | 'closed';

export interface StatusDotProps {
  s: StatusKind;
}

const DOT_COLOR: Record<StatusKind, string> = {
  active:   'var(--pos)',
  inactive: 'var(--fg-4)',
  prospect: 'var(--info)',
  lead:     'var(--purple)',   // violet — raw lead
  client:   'var(--warn)',   // amber  — prospective client (enquiry in hand)
  closed:   'var(--neg)',
};

export function StatusDot({ s }: StatusDotProps) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: DOT_COLOR[s] ?? 'var(--fg-4)',
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    />
  );
}
