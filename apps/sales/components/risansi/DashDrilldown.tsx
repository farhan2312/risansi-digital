'use client';

import {
  createContext, useContext, useMemo, useState, useTransition,
  type CSSProperties, type ReactNode,
} from 'react';
import {
  dashDrilldown, type DashDrillParams, type DashDrillResult, type DashUnit, type DrillRow,
} from '@/app/actions/risansi-dashboard-drilldown';
import { fmtCr, fmtL, formatRev } from '@/lib/risansi-utils';
import { useTableSort, SortTH } from './SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';

// Click a number on the landing dashboard, see the clients it is made of.
//
// The same shape as ExecDrilldown and AuditDrilldown: one provider holds the
// open panel and one <DashCell> wraps each figure, so a page with forty numbers
// on it carries one modal rather than forty. Rows are fetched on click —
// prefetching every breakdown would mean running two dozen more aggregates to
// render a page where the reader opens at most one or two.

interface Ctx { open: (p: DashDrillParams) => void }
const DrillCtx = createContext<Ctx | null>(null);

/**
 * Print a figure the way the tile that was clicked printed it.
 *
 * The whole point of the panel is that its headline and the number above it are
 * the same number, and "₹4,21,00,000" against a tile reading "₹4.21 Cr" makes
 * the reader do arithmetic to believe it. So the unit travels with the result
 * and the formatter here is the one the page itself used.
 */
function fmt(unit: DashUnit, n: number, place: 'total' | 'row' = 'row'): string {
  switch (unit) {
    case 'inr':  return formatRev(Math.round(n));
    case 'lakh': return fmtL(n);
    // The crore tiles print one decimal, so the headline does too and the two
    // read identically. Rows get a second decimal, because at one decimal a
    // long tail of real contributors all round to ₹0.0 Cr.
    case 'cr':   return fmtCr(n, place === 'total' ? 1 : 2);
    case 'units': return `${Math.round(n).toLocaleString('en-IN')}`;
    default:     return Math.round(n).toLocaleString('en-IN');
  }
}

// The three columns of the breakdown table. Every row the drill-down fetched is
// already in hand — the panel holds the whole list and filters it in the browser
// — so this sorts in memory rather than going back for an ORDER BY.
//
// The value column reads r.value, the raw number, not the "₹4.21 Cr" the cell
// prints: sorting the formatted string would put ₹9 L above ₹4 Cr.
const DRILL_COLS: SortableColumn<DrillRow>[] = [
  { key: 'code',  kind: 'text' },
  { key: 'name',  kind: 'text' },
  { key: 'value', kind: 'number' },
];

export function DashDrilldownProvider({ children }: { children: ReactNode }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DashDrillResult | null>(null);
  const [showing, setShowing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');

  const open = (p: DashDrillParams) => {
    setShowing(true); setResult(null); setFailed(false); setQ('');
    start(async () => {
      const r = await dashDrilldown(p);
      if (!r) { setFailed(true); return; }
      setResult(r);
    });
  };

  const rows = useMemo(() => {
    if (!result) return [];
    const t = q.trim().toLowerCase();
    return t
      ? result.rows.filter(r => r.code.toLowerCase().includes(t) || r.name.toLowerCase().includes(t))
      : result.rows;
  }, [result, q]);

  const { rows: shown, sortBy } = useTableSort(rows, DRILL_COLS);

  const close = () => { setShowing(false); setResult(null); setQ(''); };

  // A count-only breakdown prints no value, so the column has no heading and
  // nothing to order by; it stays a plain cell rather than offering an arrow
  // over an empty column.
  const valueLabel = result == null
    ? ''
    : result.unit === 'count' ? '' : result.unit === 'units' ? 'Units' : 'Value';

  return (
    <DrillCtx.Provider value={{ open }}>
      {children}
      {showing && (
        <>
          <div onClick={close} style={SCRIM} />
          <div className="risansi-modal" style={MODAL} role="dialog" aria-label="Breakdown">
            <div style={HEAD}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{result?.title ?? 'Loading…'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                  {result?.subtitle ?? ''}
                </div>
              </div>
              <button onClick={close} style={X} aria-label="Close">×</button>
            </div>

            {pending && !result && (
              <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' }}>
                Loading the breakdown…
              </div>
            )}

            {failed && (
              <div style={{ padding: '26px 20px', fontSize: 13, color: 'var(--fg-2)' }}>
                That breakdown could not be loaded. It may be a figure you are not
                scoped to see, in which case the number above it is a total you can
                read but not itemise.
              </div>
            )}

            {result && (
              <>
                <div style={SUMMARY}>
                  <span>
                    <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 15 }}>
                      {fmt(result.unit, result.total)}
                    </strong>
                    <span style={{ color: 'var(--fg-3)', marginLeft: 6, fontSize: 12 }}>
                      across {result.rows.length} client{result.rows.length === 1 ? '' : 's'}
                      {result.secondary ? ` · ${result.secondary}` : ''}
                    </span>
                  </span>
                  {result.rows.length > 8 && (
                    <input
                      value={q} onChange={e => setQ(e.target.value)}
                      placeholder="Search code or name…"
                      style={SEARCH}
                    />
                  )}
                </div>

                {result.rows.length === 0 ? (
                  <div style={{ padding: '26px 20px', fontSize: 13, color: 'var(--fg-3)' }}>
                    Nothing behind this figure — it is zero.
                  </div>
                ) : (
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                      <thead>
                        <tr>
                          <SortTH {...sortBy('code')} style={TH}>Code</SortTH>
                          <SortTH {...sortBy('name')} style={TH}>Client</SortTH>
                          {valueLabel
                            ? <SortTH {...sortBy('value')} style={TH} align="right">{valueLabel}</SortTH>
                            : <th style={{ ...TH, textAlign: 'right' }} />}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r, i) => (
                          <tr key={`${r.clientId}-${i}`}>
                            <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                              {r.code}
                            </td>
                            <td style={TD}>
                              {/* A row the assessment sheet never matched to an
                                  account has no Client 360 to open. */}
                              {r.clientId > 0 ? (
                                <a href={`/risansi/clients/${r.clientId}`}
                                  style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
                                  {r.name}
                                </a>
                              ) : (
                                <span style={{ fontWeight: 500 }}>{r.name}</span>
                              )}
                              {r.detail && (
                                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 1 }}>{r.detail}</div>
                              )}
                            </td>
                            <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                              {r.value != null ? fmt(result.unit, r.value) : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={FOOT}>
                  {rows.length !== result.rows.length && `${rows.length} of ${result.rows.length} shown · `}
                  Click a client to open their Client 360.
                </div>
              </>
            )}
          </div>
        </>
      )}
    </DrillCtx.Provider>
  );
}

/**
 * Wrap a figure to make it open its own breakdown.
 *
 * A button rather than a link: the rows are fetched on demand and shown in
 * place, so there is no URL to navigate to and nothing to open in a new tab. It
 * carries the underline-on-hover a link would, because a number that responds to
 * a click has to look like it will — and the figures that have no honest list
 * behind them (a percentage, the annual target) are deliberately left outside
 * this wrapper so they stay plain text.
 */
export function DashCell({ params, children, style, title }: {
  params: DashDrillParams; children: ReactNode; style?: CSSProperties; title?: string;
}) {
  const ctx = useContext(DrillCtx);
  if (!ctx) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => ctx.open(params)}
      title={title ?? 'See the clients behind this figure'}
      style={{
        background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit',
        color: 'inherit', cursor: 'pointer', textAlign: 'inherit', textDecorationLine: 'underline',
        textDecorationStyle: 'dotted', textDecorationColor: 'var(--line-strong)',
        textUnderlineOffset: 3, ...style,
      }}
    >
      {children}
    </button>
  );
}

const SCRIM: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.4)', zIndex: 400 };
const MODAL: CSSProperties = {
  position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
  width: 660, maxWidth: 'calc(100vw - 32px)', height: 'min(76vh, 680px)',
  display: 'flex', flexDirection: 'column',
  background: 'var(--bg-paper)', borderRadius: 12, zIndex: 401,
  boxShadow: '0 24px 70px rgba(10,61,143,0.22)', overflow: 'hidden',
};
const HEAD: CSSProperties = {
  padding: '15px 18px', borderBottom: '1px solid var(--line)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexShrink: 0,
};
const X: CSSProperties = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--fg-3)', lineHeight: 1 };
const SUMMARY: CSSProperties = {
  padding: '10px 18px', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0,
};
const SEARCH: CSSProperties = {
  padding: '5px 9px', fontSize: 12, fontFamily: 'inherit', width: 200,
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)',
};
const TH: CSSProperties = {
  padding: '8px 14px', textAlign: 'left', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.07em',
  textTransform: 'uppercase', color: 'var(--fg-3)', borderBottom: '1px solid var(--line)',
  background: 'var(--bg-paper)', position: 'sticky', top: 0,
};
const TD: CSSProperties = { padding: '8px 14px', fontSize: 12.5, borderBottom: '1px solid var(--line-2)', verticalAlign: 'top' };
const FOOT: CSSProperties = {
  padding: '9px 18px', borderTop: '1px solid var(--line)', fontSize: 11.5,
  color: 'var(--fg-3)', background: 'var(--bg-elev)', flexShrink: 0,
};
