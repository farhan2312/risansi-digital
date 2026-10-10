import Link from 'next/link';
import type { CSSProperties } from 'react';

// "Raise a complaint for this client", from visit reports and Client 360.
// A link into the complaints module with the client preselected; the module
// owns the form, so registration is the same everywhere it starts.
export function LogComplaintButton({ clientId, style, label = '⚠ Log Complaint' }: {
  clientId: number; clientName?: string; style?: CSSProperties; label?: string;
}) {
  return <Link href={`/risansi/complaints/new?client=${clientId}`} style={{ ...BTN, ...style }}>{label}</Link>;
}

const BTN: CSSProperties = {
  display: 'inline-block', padding: '8px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  background: 'var(--bg-paper)', color: 'var(--neg)', border: '1px solid rgba(220,38,38,0.35)',
  borderRadius: 6, cursor: 'pointer', textDecoration: 'none',
};
