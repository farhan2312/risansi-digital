'use client';

import { createContext, useContext, useState, useTransition, useMemo, type ReactNode, type CSSProperties } from 'react';
import { execDrilldown, type DrillParams, type DrillResult, type DrillRow } from '@/app/actions/risansi-exec-drilldown';
import { useTableSort, SortTH } from './SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';

// Click a number on the Executive Review, see the clients it is made of.
//
// One provider holds the open panel and one <DrillCell> wraps each figure, so a
// page with sixty numbers on it carries one modal rather than sixty. The rows
// are fetched when the cell is clicked: prefetching every breakdown would mean
// running about forty aggregate queries to render a page where the reader opens
// at most one or two.

interface Ctx { open: (p: DrillParams) => void; }
const DrillCtx = createContext<Ctx | null>(null);

const fmtINR = (n: number) =>
  '₹' + Math.round(n).toLocaleString('en-IN');

// The three columns of the breakdown table. The panel holds the whole list and
// filters it in the browser, so every row is already in hand and this sorts in
// memory rather than going back to the server for an ORDER BY.
//
// The value column reads r.value, the raw rupee figure, not the "₹4,21,000" the
// cell prints: sorting the formatted string would order by the first digit.
const DRILL_COLS: SortableColumn<DrillRow>[] = [
  { key: 'code',  kind: 'text' },
  { key: 'name',  kind: 'text' },
  { key: 'value', kind: 'number' },
];

export function ExecDrilldownProvider({ tsm, scope, fy, children }: {
  tsm: string; scope: 'own' | 'all';
  /** The FY the page is showing, injected into every drill so the list matches the figure. */
  fy: string;
  children: ReactNode;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DrillResult | null>(null);
  const [showing, setShowing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');

  const open = (p: DrillParams) => {
    setShowing(true); setResult(null); setFailed(false); setQ('');
    start(async () => {
      const r = await execDrilldown({ ...p, tsm, scope, fy });
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
  const valueLabel = result?.unit === 'money' ? 'Value' : '';

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
                      {result.unit === 'money' ? fmtINR(result.total) : result.total}
                    </strong>
                    <span style={{ color: 'var(--fg-3)', marginLeft: 6, fontSize: 12 }}>
                      across {result.rows.length} client{result.rows.length === 1 ? '' : 's'}
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
                              <a href={`/risansi/clients/${r.clientId}`}
                                style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
                                {r.name}
                              </a>
                              {r.detail && (
                                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 1 }}>{r.detail}</div>
                              )}
                            </td>
                            <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                              {r.value != null ? fmtINR(r.value) : ''}
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
 * place, so there is no URL to navigate to and nothing to open in a new tab.
 * It carries the underline-on-hover a link would, because a number that responds
 * to a click has to look like it will.
 */
export function DrillCell({ params, children, style }: {
  params: DrillParams; children: ReactNode; style?: CSSProperties;
}) {
  const ctx = useContext(DrillCtx);
  if (!ctx) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => ctx.open(params)}
      title="See the clients behind this figure"
      style={{
        background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit',
        color: 'inherit', cursor: 'pointer', textDecorationLine: 'underline',
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
