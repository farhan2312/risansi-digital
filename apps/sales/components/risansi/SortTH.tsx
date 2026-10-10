'use client';

// A sortable header for a table whose rows are all already on the page.
//
// The other one, SortableTH, writes ?sort= & ?dir= into the URL and lets the
// server re-run the query. That is the right tool when the table is one page of
// a longer list; this one is for the rest, where the rows are in hand and the
// round trip would buy nothing.
//
// Applying it to a table takes two lines:
//
//   const { rows, sortBy } = useTableSort(data, COLS);
//   <SortTH {...sortBy('legal_name')} style={TH}>Client</SortTH>
//
// COLS names every sortable column and says what kind it is, which is what
// decides the first click's direction — see lib/risansi-table-sort.ts.

import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  type SortState, type SortableColumn,
  sortRows, nextSort, sortMark,
} from '@/lib/risansi-table-sort';

export function useTableSort<T>(
  rows: T[],
  cols: SortableColumn<T>[],
  initial: SortState = { key: null, dir: 'asc' },
) {
  const [sort, setSort] = useState<SortState>(initial);

  /** Choose a column by key, as a header click would. */
  const pick = (key: string) => {
    const col = cols.find(c => c.key === key);
    if (col) setSort(cur => nextSort(cur, key, col.kind));
  };

  return {
    /** The rows in the chosen order — the original array while nothing is chosen. */
    rows: sortRows(rows, cols, sort),
    sort,
    setSort,
    pick,
    /**
     * Everything <MobileSort> needs, ready to spread. A table in card view has
     * no header row on a phone, so without this it cannot be sorted there at
     * all — which is most of the tables somebody actually reads on a phone.
     */
    mobile: {
      options: cols.filter(c => c.label).map(c => ({ key: c.key, label: c.label as string })),
      sort: sort.key,
      dir: sort.dir,
      onPick: pick,
    },
    /** Props for a <SortTH>. Spread it: `<SortTH {...sortBy('name')}>Name</SortTH>`. */
    sortBy(key: string) {
      const col = cols.find(c => c.key === key);
      return {
        sortable: Boolean(col),
        active: sort.key === key,
        mark: sortMark(sort, key),
        dir: sort.dir,
        onSort: () => { if (col) setSort(cur => nextSort(cur, key, col.kind)); },
      };
    },
  };
}

export interface SortTHProps {
  sortable?: boolean;
  active?: boolean;
  mark?: '▲' | '▼' | '↕';
  dir?: 'asc' | 'desc';
  onSort?: () => void;
  style?: CSSProperties;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
  title?: string;
  /** Goes on the <th> itself. Some tables freeze a column by class rather than
   *  by inline style — the complaints table's sticky number and client columns
   *  are un-frozen for phones from app/mobile.css — and a header that dropped
   *  the class would stay stuck while its body cells scrolled away beneath it. */
  className?: string;
  children: ReactNode;
}

export function SortTH({
  sortable = true, active = false, mark = '↕', dir = 'asc', onSort,
  style, align, colSpan, title, className, children,
}: SortTHProps) {
  // `align` is applied AFTER the table's own style, not before. A table's shared
  // TH object usually carries a textAlign of its own, and spreading it last
  // would quietly beat the per-column align this header was given.
  const cell: CSSProperties = { ...style, ...(align ? { textAlign: align } : {}) };

  // A column nobody can sort still has to look like the ones beside it, so it
  // renders the same cell without the affordance rather than a different cell.
  if (!sortable || !onSort) {
    return <th colSpan={colSpan} className={className} title={title} style={cell}>{children}</th>;
  }

  return (
    <th
      colSpan={colSpan}
      className={className}
      // aria-sort is what tells a screen reader the table is ordered and which
      // way; the arrow alone says it only to people who can see it.
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ ...cell, cursor: 'pointer', userSelect: 'none' }}
    >
      <span
        role="button"
        tabIndex={0}
        title={title ?? 'Sort'}
        onClick={onSort}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(); }
        }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          // Right-aligned columns put the arrow on the left so it sits beside
          // the label rather than drifting away from it against the edge.
          flexDirection: align === 'right' ? 'row-reverse' : 'row',
          color: active ? 'var(--accent)' : undefined,
          font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit',
        }}
      >
        {children}
        <span style={{ fontSize: 8, opacity: active ? 1 : 0.22 }}>{mark}</span>
      </span>
    </th>
  );
}
