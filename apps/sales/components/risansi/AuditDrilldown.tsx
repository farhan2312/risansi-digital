'use client';

import { createContext, useContext, useMemo, useState, useTransition, type ReactNode, type CSSProperties } from 'react';
import Link from 'next/link';
import { auditDrilldown, type DrillKind, type AuditDrillResult } from '@/app/actions/risansi-audit-drilldown';
import type { OverallFilters } from '@/lib/risansi-audit-overall';

// Click a tile on the Overall tab, see the people or records behind it.
//
// One provider and one panel for the whole page, the same shape the Executive
// Review uses: a page with fifteen clickable numbers should carry one modal, not
// fifteen. Rows are fetched on click — the tab already runs a dozen aggregates to
// render, and a reader opens at most one or two of these.

interface Ctx { open: (kind: DrillKind) => void }
const DrillCtx = createContext<Ctx | null>(null);

export function AuditDrilldownProvider({ filters, children }: {
  filters: OverallFilters; children: ReactNode;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AuditDrillResult | null>(null);
  const [showing, setShowing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');

  const open = (kind: DrillKind) => {
    setShowing(true); setResult(null); setFailed(false); setQ('');
    start(async () => {
      const r = await auditDrilldown(kind, filters);
      if (!r) { setFailed(true); return; }
      setResult(r);
    });
  };

  const rows = useMemo(() => {
    if (!result) return [];
    const t = q.trim().toLowerCase();
    if (!t) return result.rows;
    return result.rows.filter(r =>
      r.label.toLowerCase().includes(t) || r.meta.toLowerCase().includes(t));
  }, [result, q]);

  const close = () => { setShowing(false); setResult(null); };

  return (
    <DrillCtx.Provider value={{ open }}>
      {children}
      {showing && (
        <>
          <div style={SCRIM} onClick={close} />
          <div style={MODAL} role="dialog" aria-modal="true" aria-label={result?.title ?? 'Loading'}>
            <div style={HEAD}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>
                  {result?.title ?? 'Loading…'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                  {result ? `${result.rows.length}${result.capped ? '+ (first 300)' : ''} · ${result.note}` : ' '}
                </div>
              </div>
              <button onClick={close} aria-label="Close" style={CLOSE}>×</button>
            </div>

            {result && result.rows.length > 8 && (
              <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)' }}>
                <input
                  value={q} onChange={e => setQ(e.target.value)} placeholder="Search this list…"
                  style={{
                    width: '100%', padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit',
                    background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
                    borderRadius: 6, color: 'var(--fg)',
                  }}
                />
              </div>
            )}

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {pending && <div style={EMPTY}>Loading…</div>}
              {failed && <div style={EMPTY}>Could not load this list.</div>}
              {result && rows.length === 0 && (
                <div style={EMPTY}>{q ? 'Nothing matches that.' : 'Nothing in this category.'}</div>
              )}
              {rows.map((r, i) => {
                const body = (
                  <>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 500 }}>{r.label}</span>
                      {r.meta && <span style={{ color: 'var(--fg-3)', fontSize: 11.5 }}> · {r.meta}</span>}
                    </span>
                    {r.value && (
                      <span style={{ marginLeft: 'auto', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>
                        {r.value}
                      </span>
                    )}
                  </>
                );
                return r.href
                  ? <Link key={i} href={r.href} style={{ ...ROW, textDecoration: 'none', color: 'var(--fg)' }}>{body}</Link>
                  : <div key={i} style={ROW}>{body}</div>;
              })}
            </div>
          </div>
        </>
      )}
    </DrillCtx.Provider>
  );
}

/**
 * Wraps a tile so the whole card opens its list.
 *
 * A button rather than a link: the rows are fetched on demand and shown in
 * place, so there is nothing to navigate to. Renders its children untouched when
 * there is no provider, so a tile is never accidentally made inert.
 */
export function DrillTile({ kind, children }: { kind: DrillKind; children: ReactNode }) {
  const ctx = useContext(DrillCtx);
  if (!ctx) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => ctx.open(kind)}
      title="See what this number is made of"
      className="drill-tile"
      style={{
        display: 'block', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit',
        background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

const SCRIM: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.4)', zIndex: 400 };
const MODAL: CSSProperties = {
  position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
  width: 'min(620px, calc(100vw - 32px))', maxHeight: 'min(76vh, 700px)',
  display: 'flex', flexDirection: 'column', zIndex: 401,
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)', boxShadow: '0 18px 50px rgba(10,22,40,0.28)',
};
const HEAD: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 12,
  padding: '13px 16px', borderBottom: '1px solid var(--line)',
};
const CLOSE: CSSProperties = {
  marginLeft: 'auto', flexShrink: 0, background: 'none', border: 'none',
  fontSize: 22, lineHeight: 1, color: 'var(--fg-3)', cursor: 'pointer', padding: '0 2px',
};
const ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '9px 16px', borderBottom: '1px solid var(--line-2)', fontSize: 12.5,
};
const EMPTY: CSSProperties = { padding: '28px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--fg-3)' };
