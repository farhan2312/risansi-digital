'use client';

// The sortable body of every panel on the Executive Review.
//
// It lives in a file of its own rather than inside ExecutiveViews.tsx because
// 'use client' is a property of the module, not of a component: ExecutiveViews
// also exports ExecTabs, which the review page hands a hrefFor function, and a
// function cannot cross from a server component into a client one. So the panel
// chrome, the charts and the footnotes stay on the server and only the table
// comes over, carrying nothing but the plain data it already had.
//
// Client-side sorting, because every row is already here. An ExecTable is a
// summary — eight turnover bands, seven offer statuses, twelve months — computed
// whole by the page. There is no LIMIT behind it and no second page, so sorting
// in the browser reorders the entire set rather than a window onto it.

import type { CSSProperties } from 'react';
import { DrillCell } from './ExecDrilldown';
import { useTableSort, SortTH } from './SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';
import type { ExecTable, Row } from './ExecutiveViews';

const inr = (n: number) => n.toLocaleString('en-IN');

export function ExecMiniTable({ table }: { table: ExecTable }) {
  const { headers, rows, moneyFrom, colors = [], notes = [] } = table;

  // Grand Total and the like carry `strong`. They are not rows of the table in
  // the sense that matters here — they are the table's sum — so they are kept
  // out of the sorted array and printed after it.
  const body = rows.filter(r => !r.strong);
  const totals = rows.filter(r => r.strong);

  const cols: SortableColumn<Row>[] = [
    // The first column is a set of category labels that arrived in a deliberate
    // sequence: CONVERSION_STAGES for the conversion panel, OFFER_STATUS_ORDER
    // for offer status, TURN_ORDER for the turnover bands, April-to-March for
    // attendance. That sequence is the meaning, so the column sorts as a status
    // against the order the page already put the rows in rather than being
    // re-alphabetised — "Apr, Aug, Dec" is not a reading of the year. The list
    // is read off the unsorted body, so it is the page's own order and not a
    // second copy of four constants that could drift from them.
    { key: '__label', kind: 'status', order: body.map(r => r.label), value: r => r.label },
    ...headers.slice(1).map((_, i) => ({
      // Every value column is a count or a sum of rupees, so the first click
      // gives the largest. It reads r.vals[i], the number, not the "₹12,40,000"
      // the cell prints.
      key: `v${i}`, kind: 'number' as const, value: (r: Row) => r.vals[i],
    })),
  ];

  const { rows: sortedBody, sortBy, sort } = useTableSort(body, cols);
  // Untouched, the table is exactly what the page handed over — including where
  // it chose to put a total and what it chose to put under one.
  const display = sort.key ? [...sortedBody, ...totals] : rows;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>{headers.map((h, i) => {
          const c = i > 0 ? colors[i - 1] : undefined;
          const key = i === 0 ? '__label' : `v${i - 1}`;
          return (
            <SortTH
              key={h}
              {...sortBy(key)}
              title={i > 0 ? notes[i - 1] : undefined}
              align={i === 0 ? 'left' : 'right'}
              style={{ ...TH, color: c ?? TH.color }}
            >
              {c && <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c, marginRight: 5, verticalAlign: 'middle' }} />}{h}
            </SortTH>
          );
        })}</tr>
      </thead>
      <tbody>
        {display.length === 0 ? (
          <tr><td colSpan={headers.length} style={{ ...TD, textAlign: 'center', color: 'var(--fg-3)', padding: '18px 0' }}>No data</td></tr>
        ) : display.map((r, ri) => (
          <tr key={ri} style={{ background: r.strong ? 'var(--bg-elev)' : 'transparent' }}>
            <td style={{ ...TD, fontWeight: r.strong ? 700 : 500, color: 'var(--fg)', borderTop: r.strong ? '2px solid var(--line-strong)' : '1px solid var(--line)' }}>{r.label}</td>
            {r.vals.map((v, vi) => {
              const text = v == null ? '—' : (vi >= moneyFrom ? '₹' : '') + inr(v);
              const d = r.drill?.[vi];
              return (
                <td key={vi} style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: r.strong ? 700 : 400,
                                      color: v == null || v === 0 ? 'var(--fg-3)' : colors[vi] ?? 'var(--fg)',
                                      background: colors[vi] && v ? `color-mix(in oklab, ${colors[vi]} ${r.strong ? 14 : 8}%, transparent)` : undefined,
                                      borderTop: r.strong ? '2px solid var(--line-strong)' : '1px solid var(--line)' }}>
                  {d && v ? <DrillCell params={d}>{text}</DrillCell> : text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The same two style objects the panel always used, kept here with the markup
// they belong to.
const TH: CSSProperties = { padding: '8px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, color: 'var(--fg-3)', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '8px 12px', verticalAlign: 'middle', whiteSpace: 'nowrap' };
