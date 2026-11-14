'use client';

import { useState, type CSSProperties } from 'react';
import { compareSalesOrderLines } from '@/app/actions/risansi-so-portal';
import type { SoComparison } from '@/lib/risansi-so-portal-types';

/**
 * What was quoted on an opportunity, against what its SOs actually ordered.
 *
 * WHY IT LOADS ONLY WHEN OPENED
 *
 * It crosses into another database, and Client 360 can show a dozen Won
 * opportunities at once. Twelve cross-database queries on page load, for a
 * panel most readers will not open, is a page that feels broken for everybody
 * to serve the few who want it.
 *
 * WHAT THE MATCH IS, AND IS NOT
 *
 * Models are folded (spaces, hyphens and case removed) and the two sides are
 * summed per model — see lib/risansi-so-compare.ts for why pairing rows would
 * give an answer that depends on the order they came back in. It is not a
 * reconciliation: a model quoted and ordered in the same quantity still says
 * nothing about price, and two different pumps that fold to the same string
 * would match. It answers one question — did they order what we quoted —
 * and leaves the rest to somebody reading it.
 */
export function SoLineCompare({ oppId, label = 'Quoted against ordered' }: {
  oppId: number;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SoComparison | null | 'none'>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || data !== null || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await compareSalesOrderLines(oppId);
      setData(r ?? 'none');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reach the SO portal.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ borderTop: '1px dashed var(--line-strong)', paddingTop: 8, marginTop: 8 }}>
      <button type="button" onClick={toggle} style={TOGGLE} aria-expanded={open}>
        <span style={{ color: 'var(--fg-4)', marginRight: 5 }}>{open ? '▾' : '▸'}</span>
        {label}
        {busy && <span style={{ color: 'var(--fg-4)', marginLeft: 6 }}>…</span>}
      </button>

      {open && !busy && (
        err ? <p style={NOTE}>{err}</p>
        : data === 'none' ? (
          <p style={NOTE}>
            Nothing to compare. Either no sales order is recorded here, or the SO portal
            has no lines against the ones that are.
          </p>
        ) : data ? <Table c={data} /> : null
      )}
    </div>
  );
}

function Table({ c }: { c: SoComparison }) {
  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ ...NOTE, marginTop: 0 }}>
        {c.quotedLineCount
          ? <>{c.quotedLineCount} quoted line{c.quotedLineCount === 1 ? '' : 's'} against {c.soNumbers.length} sales order{c.soNumbers.length === 1 ? '' : 's'}.{' '}</>
          : <>No quoted lines were captured on this opportunity, so only what was ordered is shown.{' '}</>}
        {c.matches
          ? <strong style={{ color: 'var(--pos-strong, var(--pos))' }}>Everything lines up.</strong>
          : <span style={{ color: 'var(--warn)' }}>
              {[c.quantityDiffers && `${c.quantityDiffers} quantity difference${c.quantityDiffers === 1 ? '' : 's'}`,
                c.quotedOnly && `${c.quotedOnly} quoted and not ordered`,
                c.orderedOnly && `${c.orderedOnly} ordered and not quoted`,
                c.nearMatches && `${c.nearMatches} look like the same pump spelt two ways`]
                .filter(Boolean).join(' · ')}
            </span>}
      </p>

      {!!c.soNotFound.length && (
        <p style={{ ...NOTE, color: 'var(--warn)' }}>
          The SO portal has no lines for {c.soNotFound.join(', ')} — those numbers may be
          wrong, or that system may not have caught up.
        </p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <thead>
          <tr>
            <th style={{ ...TH, textAlign: 'left' }}>Model</th>
            <th style={TH}>Quoted</th>
            <th style={TH}>Ordered</th>
            <th style={{ ...TH, textAlign: 'left' }}>On SO</th>
          </tr>
        </thead>
        <tbody>
          {c.rows.map(r => {
            const off = r.side !== 'both' || (r.diff ?? 0) !== 0;
            return (
              <tr key={r.model + r.soNos.join()}>
                <td style={{ ...TD, fontFamily: 'var(--font-mono)', color: off ? 'var(--fg)' : 'var(--fg-2)' }}>
                  {r.model}
                  {r.side === 'ordered-only' && <Tag>not quoted</Tag>}
                  {r.side === 'quoted-only' && <Tag>not ordered</Tag>}
                  {r.nearMatch && (
                    <div title="One or two characters apart from the model on the other side. Almost always the same pump typed twice — worth settling which spelling is right."
                         style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'inherit' }}>
                      ≈ {r.nearMatch}
                    </div>
                  )}
                </td>
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {r.quotedQty != null ? r.quotedQty
                    : r.quotedGrouped
                      ? <span title="The quote listed this model together with others under one quantity, so there is no number to put against it on its own."
                              style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'inherit' }}>listed</span>
                      : '—'}
                </td>
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)',
                             color: off ? 'var(--warn)' : undefined }}>
                  {r.orderedQty ?? '—'}
                  {r.diff != null && r.diff !== 0 && (
                    <span style={{ fontSize: 10, marginLeft: 4 }}>({r.diff > 0 ? '+' : ''}{r.diff})</span>
                  )}
                </td>
                <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-3)' }}>
                  {r.soNos.join(', ') || '—'}
                  {!!r.serials.length && (
                    <div title={r.serials.join(', ')} style={{ color: 'var(--fg-4)' }}>
                      {r.serials.length} serial{r.serials.length === 1 ? '' : 's'}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ ...TD, fontWeight: 600, borderBottom: 'none' }}>Total pumps</td>
            <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, borderBottom: 'none' }}>
              {c.quotedQty || '—'}
            </td>
            <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, borderBottom: 'none' }}>
              {c.orderedQty || '—'}
            </td>
            <td style={{ ...TD, borderBottom: 'none' }} />
          </tr>
        </tfoot>
      </table>

      <p style={{ ...NOTE, marginBottom: 0 }}>
        Models are matched ignoring spaces, hyphens and case — the same pump is written
        both ways on the same sales order. A quote line holding several models under one
        quantity contributes the models but no number, and reads “listed”. Quantities
        only; price is not compared.
      </p>
    </div>
  );
}

function Tag({ children }: { children: string }) {
  return (
    <span style={{ fontSize: 9.5, marginLeft: 6, padding: '0 4px', borderRadius: 3,
                   border: '1px solid var(--warn)', color: 'var(--warn)', fontFamily: 'inherit' }}>
      {children}
    </span>
  );
}

const TOGGLE: CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 11.5, color: 'var(--accent)', textAlign: 'left',
};

const NOTE: CSSProperties = {
  margin: '7px 0', fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.5,
};

const TH: CSSProperties = {
  fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'right',
  color: 'var(--fg-4)', fontWeight: 500, padding: '0 6px 4px 0',
  borderBottom: '1px solid var(--line)',
};

const TD: CSSProperties = {
  padding: '4px 6px 4px 0', borderBottom: '1px solid var(--line)', color: 'var(--fg-2)',
  verticalAlign: 'top',
};
