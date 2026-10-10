'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { stageTone } from '@/lib/risansi-stage-tone';
import { useRouter } from 'next/navigation';
import { EditOppDrawer, type EditableOpp } from './EditOppDrawer';
import { fmtUsdFromCr } from '@/lib/risansi-utils';
import { ALL_STAGES } from '@/lib/risansi-opportunity-fields';
import { useTableSort, SortTH } from './SortTH';
import { MobileSort } from './MobileSort';
import type { SortableColumn } from '@/lib/risansi-table-sort';

const PAGE_SIZE = 50;

// A Prospect or a Suspect has no quote date, and the column read "—" for every
// one of them. It carries the enquiry date instead, marked as such, so the
// first column always says when the deal entered the book. Sorting follows.
const dateOf = (o: EditableOpp) => o.quote_date || o.enquiry_date || '';

// Stage sorts down the pipeline, not down the alphabet, and ALL_STAGES is the
// list the rest of the module already works from.
// The labels are for the phone sort menu, where this table is cards and has no
// header row to tap.
const COLS: SortableColumn<EditableOpp>[] = [
  { key: 'date',    kind: 'date',   label: 'Quote / enquiry date', value: dateOf },
  { key: 'client',  kind: 'text',   label: 'Client',               value: o => o.client_name },
  { key: 'stage',   kind: 'status', label: 'Stage', order: ALL_STAGES, value: o => o.stage },
  { key: 'value',   kind: 'number', label: 'Value',                value: o => o.value_cr },
  { key: 'product', kind: 'text',   label: 'Product',              value: o => [o.product, o.product_type].filter(Boolean).join(' · ') },
  { key: 'eta',     kind: 'text',   label: 'Expected close',       value: o => o.eta_text },
];

export function ActiveOppsTable({ opps, usdRate }: { opps: EditableOpp[]; usdRate?: number }) {
  const router = useRouter();
  const [selectedOpp, setSelectedOpp] = useState<EditableOpp | null>(null);
  const [page, setPage] = useState(0);
  // Every opportunity is already here; the pages below are slices of this
  // array, not of a query, so the sort belongs in memory and covers all of them.
  const { rows: sorted, sort, sortBy, mobile } = useTableSort(opps, COLS);

  // A new sort re-decides which rows are first, so staying on page 7 would hide
  // exactly the rows the click was asking for.
  useEffect(() => { setPage(0); }, [sort.key, sort.dir]);

  if (opps.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
        No open opportunities
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage  = Math.min(page, pageCount - 1);
  const start     = safePage * PAGE_SIZE;
  const rows      = sorted.slice(start, start + PAGE_SIZE);

  return (
    <>
      {/* Only shows on a phone, where the header row below is hidden. */}
      <div className="r-mobile-only" style={{ margin: '4px 0 8px' }}>
        <MobileSort {...mobile} />
      </div>
      <div style={{ overflowX: 'auto', marginTop: 4 }}>
        <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elev)' }}>
              <SortTH {...sortBy('date')}    style={TH}>Quote / Enquiry Date</SortTH>
              <SortTH {...sortBy('client')}  style={TH}>Client</SortTH>
              <SortTH {...sortBy('stage')}   style={TH}>Stage</SortTH>
              <SortTH {...sortBy('value')}   style={TH} align="right">Value</SortTH>
              <SortTH {...sortBy('product')} style={TH}>Product &amp; Notes</SortTH>
              <SortTH {...sortBy('eta')}     style={TH}>Expected Close</SortTH>
            </tr>
          </thead>
          <tbody>
            {rows.map(opp => {
              const stageColor = stageTone(opp.stage);
              return (
                <tr
                  key={opp.id}
                  onClick={() => setSelectedOpp(opp)}
                  style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer', transition: 'background 100ms' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td data-label="Quote / Enquiry Date" style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                    {opp.quote_date ? opp.quote_date
                      : opp.enquiry_date ? (
                        <span title="No quotation yet — this is the enquiry date">
                          {opp.enquiry_date}
                          <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-4)' }}>enq</span>
                        </span>
                      ) : '—'}
                  </td>
                  <td data-label="Client" style={TD}>
                    <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 12 }}>{opp.client_name}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{opp.client_code}</div>
                  </td>
                  <td data-label="Stage" style={TD}>
                    <span style={{
                      padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                      background: `${stageColor}18`, color: stageColor, border: `1px solid ${stageColor}40`,
                    }}>
                      {opp.stage}
                    </span>
                  </td>
                  <td data-label="Value" style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--title)', whiteSpace: 'nowrap' }}>
                    {opp.value_cr ? `₹${(opp.value_cr * 100).toFixed(1)}L` : '—'}
                    {opp.value_cr && usdRate ? (
                      <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--fg-3)', marginTop: 1 }}>
                        ≈ {fmtUsdFromCr(opp.value_cr, usdRate)}
                      </div>
                    ) : null}
                  </td>
                  <td data-label="Product & Notes" style={{ ...TD, maxWidth: 340 }}>
                    <div style={{ color: 'var(--fg)' }}>
                      {opp.product}{opp.product_type ? ` · ${opp.product_type}` : ''}
                      {opp.auto_created && (
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4, marginLeft: 6,
                          background: 'var(--accent-soft)', color: 'var(--brand-blue)', textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>⚡ Auto</span>
                      )}
                    </div>
                    {opp.notes && (
                      <div style={{
                        fontSize: 10, color: 'var(--fg-3)', marginTop: 2, lineHeight: 1.4,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {opp.notes}
                      </div>
                    )}
                  </td>
                  <td data-label="Expected Close" style={{ ...TD, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {opp.eta_text || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '10px 12px', borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--fg-3)',
      }}>
        <span>
          {start + 1}–{Math.min(start + PAGE_SIZE, sorted.length)} of {sorted.length}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PageBtn label="‹ Prev" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} />
          <span style={{ fontFamily: 'var(--font-mono)', minWidth: 70, textAlign: 'center' }}>
            Page {safePage + 1} / {pageCount}
          </span>
          <PageBtn label="Next ›" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} />
        </div>
      </div>

      {selectedOpp && (
        <EditOppDrawer
          opp={selectedOpp}
          onClose={() => { setSelectedOpp(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function PageBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      style={{
        padding: '5px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit',
        border: '1px solid var(--line-strong)',
        background: disabled ? 'var(--bg-elev)' : 'var(--bg-paper)',
        color: disabled ? 'var(--fg-3)' : 'var(--fg-2)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em',
  borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)',
};

const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
