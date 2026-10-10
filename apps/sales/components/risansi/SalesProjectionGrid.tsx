'use client';

// The rep × period grid of the Sales Projection, with sortable headers.
//
// Separate from SalesProjection.tsx because 'use client' applies to the whole
// module and that component is handed a hrefFor function by the review page — a
// function cannot cross from a server component into a client one. So the
// coverage band, the charts and the footnote stay on the server and only the
// grid comes over, carrying plain numbers.
//
// Sorted in the browser, because every rep is already here. The projection is
// computed whole for the reps the viewer is allowed to see; there is no LIMIT
// behind it and no second page, so a sort reorders the entire table rather than
// a window onto it.
//
// The All-reps line is a <tfoot> and is never part of the sorted array, so it
// stays at the bottom whichever column is pointing which way.

import type { CSSProperties } from 'react';
import { useTableSort, SortTH } from './SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';

export interface ProjCol {
  key: string;
  label: string;
  /** The header's tooltip, for the three columns that are not periods. */
  hint?: string;
  /** Draw the 2px rule to the left of this column. */
  rule?: boolean;
  /** Print the figures bold — the two totals columns. */
  strong?: boolean;
  /** Colour for the figures in the body, as a CSS var. */
  tone?: string;
  /** Colour for the figure on the All-reps line, as a CSS var. */
  footTone?: string;
}

export interface ProjRow {
  id: string;
  name: string;
  /** A second line under the rep's name — "nothing dated". */
  note?: string;
  /** Gross value per column key, in rupees. */
  vals: Record<string, number>;
  /** Opportunity count per column key, for the cell's tooltip. */
  counts: Record<string, number>;
}

// ₹ Crores to two decimals, and an em-dash for a true zero so the eye skips it.
const crShort = (n: number) => (n === 0 ? '—' : (n / 1e7).toFixed(2));

export function SalesProjectionGrid({ cols, rows, totals, emptyNote }: {
  cols: ProjCol[];
  rows: ProjRow[];
  totals: Record<string, number>;
  emptyNote: string;
}) {
  const sortCols: SortableColumn<ProjRow>[] = [
    { key: 'rep', kind: 'text', value: r => r.name },
    // Every other column is rupees, so the first click gives the largest. It
    // reads the raw figure rather than the "1.42" the cell prints, and a column
    // a rep has nothing in reads 0 rather than blank — a rep with no pipeline in
    // Q3 genuinely has zero there, which is not the same as a missing value.
    ...cols.map(c => ({ key: c.key, kind: 'number' as const, value: (r: ProjRow) => r.vals[c.key] ?? 0 })),
  ];
  const { rows: sorted, sortBy } = useTableSort(rows, sortCols);

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ background: 'var(--bg-elev)' }}>
          <SortTH {...sortBy('rep')} align="left"
            style={{ ...TH, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-elev)', minWidth: 150 }}>
            Rep
          </SortTH>
          {cols.map(c => (
            <SortTH key={c.key} {...sortBy(c.key)} align="right" title={c.hint}
              style={c.rule ? { ...TH, borderLeft: '2px solid var(--line-strong)' } : TH}>
              {c.label}
            </SortTH>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={cols.length + 1} style={{ ...TD, textAlign: 'center', color: 'var(--fg-3)', padding: 24 }}>
            {emptyNote}
          </td></tr>
        )}
        {sorted.map(rep => (
          <tr key={rep.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
            <td style={{ ...TD, fontWeight: 500, position: 'sticky', left: 0, background: 'var(--bg-paper)' }}>
              {rep.name}
              {rep.note && (
                <div style={{ fontSize: 9.5, color: 'var(--warn-strong, var(--warn))' }}>{rep.note}</div>
              )}
            </td>
            {cols.map(c => {
              const count = rep.counts[c.key] ?? 0;
              return (
                <td key={c.key}
                  title={count ? `${count} opportunit${count === 1 ? 'y' : 'ies'}` : undefined}
                  style={{
                    ...NUM,
                    ...(c.strong ? { fontWeight: 700 } : {}),
                    ...(c.tone ? { color: c.tone } : {}),
                    ...(c.rule ? { borderLeft: '2px solid var(--line-strong)' } : {}),
                  }}>
                  {crShort(rep.vals[c.key] ?? 0)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      {rows.length > 0 && (
        <tfoot>
          <tr style={{ background: 'var(--bg-elev)', fontWeight: 700 }}>
            <td style={{ ...TD, position: 'sticky', left: 0, background: 'var(--bg-elev)' }}>All reps</td>
            {cols.map(c => (
              <td key={c.key} style={{
                ...NUM,
                ...(c.footTone ? { color: c.footTone } : {}),
                ...(c.rule ? { borderLeft: '2px solid var(--line-strong)' } : {}),
              }}>
                {crShort(totals[c.key] ?? 0)}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

const TH: CSSProperties = {
  padding: '8px 10px', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em',
  fontWeight: 700, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)',
  whiteSpace: 'nowrap', textAlign: 'right',
};
const TD: CSSProperties = { padding: '7px 10px', whiteSpace: 'nowrap' };
const NUM: CSSProperties = { ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };
