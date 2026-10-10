import type { CSSProperties } from 'react';
import type { ComplaintListRow } from '@/lib/risansi-complaint-rows';
import { ComplaintTableClient } from './ComplaintTableClient';

// The complaints list as a table: one row per complaint, open first, each
// saying where it is, who is holding it and for how long.
//
// The table itself is a client component, because the column picker and the
// scroll position are the reader's to keep. This half stays on the server for
// the empty state, which needs no interactivity and should not cost a client
// bundle to say that nothing matched. It used to resolve a `sortHref` function
// into plain strings as well — functions cannot cross into a client component —
// but the table sorts itself in memory now and the links went with it.

export function ComplaintTable({ rows }: { rows: ComplaintListRow[] }) {
  if (!rows.length) {
    return (
      <div style={{ ...PANEL, padding: 32, textAlign: 'center', fontSize: 12.5, color: 'var(--fg-3)' }}>
        No complaints match. Clear a filter, or raise one.
      </div>
    );
  }
  return <ComplaintTableClient rows={rows} />;
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
