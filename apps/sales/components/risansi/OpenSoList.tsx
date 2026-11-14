import type { CSSProperties } from 'react';
import type { OpenSo } from '@/lib/risansi-order-in-hand';

/**
 * A client's open sales orders, straight from the SO portal.
 *
 * Read-only on purpose. SOs are raised, held and dispatched in that system;
 * reproducing its controls here would be two places to change one thing and
 * two answers when they disagree. This is the rep's view of "where is my
 * customer's order", nothing more.
 *
 * Sorted newest first by the query. The age column is the point of the table:
 * ₹2.97 Cr of the company's open book has been sitting four to six months,
 * and that is invisible until somebody puts the days on the screen.
 */
export function OpenSoList({ sos, dense = false }: { sos: OpenSo[]; dense?: boolean }) {
  if (!sos.length) {
    return (
      <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: dense ? '6px 0' : '10px 0' }}>
        Nothing open on the SO portal.
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {['SO number', 'Raised', 'Value', 'Status', 'Age'].map((h, i) => (
            <th key={h} style={{ ...TH, textAlign: i === 2 || i === 4 ? 'right' : 'left' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sos.map(so => (
          <tr key={so.soNo}>
            <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{so.soNo}</td>
            <td style={{ ...TD, color: 'var(--fg-3)' }}>{so.soDate ?? '—'}</td>
            <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
              {so.valueCr > 0 ? `₹${so.valueCr.toFixed(2)} Cr` : '—'}
            </td>
            <td style={TD}><StatusChip status={so.status} /></td>
            <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)',
                         color: age(so.ageDays) }}>
              {so.ageDays == null ? '—' : `${so.ageDays}d`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Red past six months, amber past three.
 *
 * Not a status the SO portal keeps — it is arithmetic on the SO date — so it
 * is coloured here rather than pretending to be their field.
 */
function age(days: number | null): string {
  if (days == null) return 'var(--fg-3)';
  if (days >= 180) return 'var(--neg)';
  if (days >= 90) return 'var(--warn)';
  return 'var(--fg-2)';
}

function StatusChip({ status }: { status: string }) {
  // Hold is the one worth colouring: it is an order we owe with something
  // blocking it, and it reads as ordinary progress otherwise.
  const hold = /hold/i.test(status);
  return (
    <span style={{
      fontSize: 10.5, padding: '1px 6px', borderRadius: 3,
      border: `1px solid ${hold ? 'var(--warn)' : 'var(--line)'}`,
      color: hold ? 'var(--warn)' : 'var(--fg-3)',
      background: hold ? 'var(--warn-soft)' : 'transparent',
      whiteSpace: 'nowrap',
    }}>{status}</span>
  );
}

const TH: CSSProperties = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em',
  color: 'var(--fg-4)', fontWeight: 500, padding: '0 8px 5px 0',
  borderBottom: '1px solid var(--line)',
};

const TD: CSSProperties = {
  padding: '6px 8px 6px 0', borderBottom: '1px solid var(--line)',
  color: 'var(--fg-2)', verticalAlign: 'top',
};
