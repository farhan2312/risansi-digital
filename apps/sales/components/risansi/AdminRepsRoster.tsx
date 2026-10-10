'use client';

// Who works here — the roster on Admin › Reps & Managers.
//
// Sorted in the browser, because the page fetches every active rep and manager
// in one go: there is no LIMIT, no page 2, and nothing a round trip could tell
// us that the rows already on screen cannot.
//
// Reports-to and Team are joins the page resolves before handing the rows over.
// They arrive as the strings the cells print, so the column orders on the names
// a reader can actually see, and a person with nobody above or below them has
// an empty value, which sinks to the bottom either way.

import type { CSSProperties } from 'react';
import { useTableSort, SortTH } from '@/components/risansi/SortTH';
import { ROLES } from '@/components/risansi/UsersManager';
import type { SortableColumn } from '@/lib/risansi-table-sort';

export interface RepRosterRow {
  id: number;
  name: string;
  role: string;
  owned: number;
  covered: number;
  /** The managers above this person, comma-joined. Empty when there are none. */
  reportsTo: string;
  /** The people below them, comma-joined. Empty when there are none. */
  team: string;
}

const COLS: SortableColumn<RepRosterRow>[] = [
  { key: 'name',      kind: 'text' },
  // The access ladder, not the alphabet: rep before manager, the way the
  // query already orders the page.
  { key: 'role',      kind: 'status', order: ROLES },
  { key: 'owned',     kind: 'number' },
  { key: 'covered',   kind: 'number' },
  { key: 'reportsTo', kind: 'text' },
  { key: 'team',      kind: 'text' },
];

export function AdminRepsRoster({ rows, th, td }: {
  rows: RepRosterRow[];
  /** The page's own header and cell styles, passed in so this table keeps them. */
  th: CSSProperties;
  td: CSSProperties;
}) {
  const { rows: shown, sortBy } = useTableSort(rows, COLS);
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          <SortTH {...sortBy('name')}      style={th}>Name</SortTH>
          <SortTH {...sortBy('role')}      style={th}>Role</SortTH>
          <SortTH {...sortBy('owned')}     style={{ ...th, textAlign: 'right' }} align="right">Owns</SortTH>
          <SortTH {...sortBy('covered')}   style={{ ...th, textAlign: 'right' }} align="right">Covers</SortTH>
          <SortTH {...sortBy('reportsTo')} style={th}>Reports to</SortTH>
          <SortTH {...sortBy('team')}      style={th}>Team</SortTH>
        </tr>
      </thead>
      <tbody>
        {shown.map(p => (
          <tr key={p.id}>
            <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
            <td style={{ ...td, fontSize: 11.5, color: 'var(--fg-3)' }}>{p.role}</td>
            <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.owned}</td>
            <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
              {p.covered || '—'}
            </td>
            <td style={{ ...td, fontSize: 12, color: 'var(--fg-2)' }}>
              {p.reportsTo || <span style={{ color: 'var(--fg-4)' }}>manages themselves</span>}
            </td>
            <td style={{ ...td, fontSize: 12, color: 'var(--fg-2)' }}>
              {p.team || <span style={{ color: 'var(--fg-4)' }}>—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
