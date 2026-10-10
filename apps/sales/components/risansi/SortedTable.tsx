'use client';

// A client-sorted table for the server-rendered pages under /risansi.
//
// Three pages needed the same thing and this is the shared answer. Two other
// tables (ExecMiniTable, SalesProjectionGrid) keep their own extraction because
// their markup is particular to one panel; anything generic belongs here.
//
// Sorting a table whose rows are all already on the page needs `useTableSort`,
// which is a hook, which needs a client component. Moving a whole table into
// one means moving its cells too — every Tag, bar and formatter the page
// already has in hand — and that is a large edit for a header click.
//
// So the page keeps its cells. It hands each row over as the <td> run it
// already renders (`cells`) plus the plain values those cells were built from
// (`values`), and this component owns only the header row and the order. The
// cells are rendered on the server and arrive as finished markup, so nothing
// server-only follows them into the browser bundle.
//
//   <SortedTable
//     columns={[{ key: 'name', label: 'Client', kind: 'text', style: TH },
//               { key: 'total', label: 'Total', kind: 'number', align: 'right', style: TH }]}
//     rows={rows.map(r => ({
//       id: r.id,
//       values: { name: r.legal_name, total: r.total },   // sort on the number…
//       cells: <>…<td>{formatRev(r.total)}</td></>,       // …not on "₹1.2 Cr"
//     }))}
//   />
//
// A column with no `kind` is not sortable — action buttons, checkboxes, a row
// index. It still renders through the same cell so it sits level with its
// neighbours. The direction the first click gives comes from the kind; see
// lib/risansi-table-sort.ts.
//
// On a phone a `className="r-cards"` table becomes cards and its header row is
// hidden, so the header this component owns is exactly what disappears. It
// renders the phone sort control itself in that case — every page that already
// passes columns with labels gets the phone sort with no edit of its own, and a
// table that keeps its header on a phone gets no second control it does not need.

import { type CSSProperties, type ReactNode } from 'react';
import { SortTH, useTableSort } from '@/components/risansi/SortTH';
import { MobileSort } from '@/components/risansi/MobileSort';
import type { SortKind } from '@/lib/risansi-table-sort';

export interface SortedTableColumn {
  key: string;
  label: ReactNode;
  /** Omit to leave the column unsortable (actions, checkboxes, row numbers). */
  kind?: SortKind;
  /** For kind 'status': the sequence that defines the order. */
  order?: readonly string[];
  /**
   * What to call this column in the phone sort menu, where there is no header
   * to read it off. Defaults to `label` when that is plain text; give it when
   * the label is markup, or when the header wording is too long to tap.
   * Set it to '' to keep a sortable column out of the menu.
   */
  mobileLabel?: string;
  align?: 'left' | 'right' | 'center';
  /** The table's own <th> style object. Passed straight through, unrestyled. */
  style?: CSSProperties;
  title?: string;
}

export interface SortedTableRow {
  id: string;
  /** The raw value behind each sortable column, keyed by column key. */
  values: Record<string, unknown>;
  /** This row's <td> run, exactly as the page renders it. */
  cells: ReactNode;
  style?: CSSProperties;
}

export interface SortedTableProps {
  columns: SortedTableColumn[];
  rows: SortedTableRow[];
  className?: string;
  style?: CSSProperties;
  headRowStyle?: CSSProperties;
  /** A border for every row, e.g. '1px solid var(--line)'. */
  divider?: string;
  /** false drops that border on the last row. */
  lastDivider?: boolean;
  /**
   * A totals row. It renders in <tfoot>, so it stays at the bottom whatever the
   * body is sorted by — a total sorted into the middle of the figures it sums
   * is worse than no total at all.
   */
  footer?: ReactNode;
}

export function SortedTable({
  columns, rows, className, style, headRowStyle,
  divider, lastDivider = true, footer,
}: SortedTableProps) {
  // Only a card-view table loses its header on a phone, so only a card-view
  // table needs the control. Anything else keeps a header row to tap, and a
  // menu above it would be a second way to do the same thing.
  const cardView = (className ?? '').split(/\s+/).includes('r-cards');

  const cols = columns
    .filter(c => c.kind)
    .map(c => ({
      key:   c.key,
      kind:  c.kind as SortKind,
      order: c.order,
      label: cardView ? mobileLabelOf(c) : undefined,
      // Always read from `values`, never from the rendered cell: a cell holding
      // '₹1.2 Cr', a badge or a bar has no order of its own.
      value: (r: SortedTableRow) => r.values[c.key],
    }));

  const { rows: ordered, sortBy, mobile } = useTableSort(rows, cols);

  return (
    <>
    {mobile.options.length > 0 && (
      <div className="r-mobile-only" style={{ margin: '4px 0 8px' }}>
        <MobileSort {...mobile} />
      </div>
    )}
    <table className={className} style={style}>
      <thead>
        <tr style={headRowStyle}>
          {columns.map(c => (
            <SortTH key={c.key} {...sortBy(c.key)} style={c.style} align={c.align} title={c.title}>
              {c.label}
            </SortTH>
          ))}
        </tr>
      </thead>
      <tbody>
        {ordered.map((r, i) => (
          <tr
            key={r.id}
            style={{
              ...(divider && (lastDivider || i < ordered.length - 1)
                ? { borderBottom: divider }
                : {}),
              ...r.style,
            }}
          >
            {r.cells}
          </tr>
        ))}
      </tbody>
      {footer && <tfoot>{footer}</tfoot>}
    </table>
    </>
  );
}

/**
 * The name this column answers to in the phone sort menu. A label that is not
 * plain text — an icon, a two-line header — has nothing to put in a menu row,
 * so the column is left out rather than listed as its raw key.
 */
function mobileLabelOf(c: SortedTableColumn): string | undefined {
  if (c.mobileLabel != null) return c.mobileLabel.trim() || undefined;
  if (typeof c.label === 'string' && c.label.trim()) return c.label.trim();
  if (typeof c.label === 'number') return String(c.label);
  return undefined;
}
