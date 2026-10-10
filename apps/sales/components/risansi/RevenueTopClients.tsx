'use client';

import { useState, useMemo, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { formatRev } from '@/lib/risansi-utils';
import { MobileSort } from './MobileSort';
import { useTableSort, SortTH } from './SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';

export interface RevenueClientRow {
  id:         string;
  code:       string;
  legal_name: string;
  industry:   string | null;
  state:      string | null;
  tier:       string | null;
  rep_name:   string;
  pump:       number;
  spare:      number;
  total:      number;
  prev_total: number;
}

const PAGE = 20;

// Every column of the table, and what it holds.
//
// The whole list is in hand — the page hands over the top hundred and "Load
// more" only widens the slice the browser is already holding — so this sorts in
// memory. Nothing here is one page of a longer query, so there is no larger set
// for a browser sort to misrepresent.
//
// The money columns sort on the raw rupee figures rather than the "₹1.2 Cr" the
// cells print, and vs LY sorts on the ratio rather than the "+12%" string. A
// client with no previous year has no ratio at all, so it reads null and sinks
// to the bottom either way, which is where the em-dash in the cell belongs.
// `label` is what the phone sort menu shows: this table becomes cards there,
// with no header row to tap.
const COLS: SortableColumn<RevenueClientRow>[] = [
  { key: 'legal_name', kind: 'text',   label: 'Client' },
  { key: 'industry',   kind: 'text',   label: 'Industry' },
  { key: 'state',      kind: 'text',   label: 'State' },
  { key: 'rep_name',   kind: 'text',   label: 'Rep' },
  { key: 'pump',       kind: 'number', label: 'Pump' },
  { key: 'spare',      kind: 'number', label: 'Spare' },
  { key: 'total',      kind: 'number', label: 'Total' },
  { key: 'vsly',       kind: 'number', label: 'vs last year',
    value: c => (c.prev_total > 0 ? (c.total - c.prev_total) / c.prev_total : null) },
  { key: 'tier',       kind: 'text',   label: 'Tier' },
];

export function RevenueTopClients({ clients }: { clients: RevenueClientRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [limit, setLimit]   = useState(PAGE);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? clients.filter(c => c.legal_name.toLowerCase().includes(q) || (c.code ?? '').toLowerCase().includes(q))
      : clients;
  }, [clients, search]);

  // No sort chosen means the order the query chose — highest revenue first —
  // which is what this panel is for. Clicking a third time comes back to it.
  const { rows: sorted, sortBy, mobile } = useTableSort(filtered, COLS);
  const shown = sorted.slice(0, limit);

  return (
    <div style={PANEL}>
      <div style={{ ...PANEL_H, justifyContent: 'space-between' }}>
        <span style={PANEL_TITLE}>Top Clients · Revenue</span>
        <input
          type="text"
          placeholder="Search name or code…"
          value={search}
          onChange={e => { setSearch(e.target.value); setLimit(PAGE); }}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line-strong)', fontSize: 12, minWidth: 220, fontFamily: 'inherit', background: 'var(--bg-paper)', color: 'var(--fg)', outline: 'none' }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
          No clients match {search ? `"${search}"` : 'the current filters'}
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <div className="r-mobile-only" style={{ margin: '0 0 8px' }}><MobileSort {...mobile} /></div>
            <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev)' }}>
                  {/* The rank is the row's position in whatever order is on
                      screen, so there is nothing to order it by. */}
                  <th style={{ ...TH, width: 44 }}>#</th>
                  <SortTH {...sortBy('legal_name')} style={TH}>Client</SortTH>
                  <SortTH {...sortBy('industry')} style={TH}>Industry</SortTH>
                  <SortTH {...sortBy('state')} style={TH}>State</SortTH>
                  <SortTH {...sortBy('rep_name')} style={TH}>Rep</SortTH>
                  <SortTH {...sortBy('pump')}  style={TH} align="right">Pump</SortTH>
                  <SortTH {...sortBy('spare')} style={TH} align="right">Spare</SortTH>
                  <SortTH {...sortBy('total')} style={TH} align="right">Total</SortTH>
                  <SortTH {...sortBy('vsly')}  style={TH} align="right">vs LY</SortTH>
                  <SortTH {...sortBy('tier')} style={TH}>Tier</SortTH>
                </tr>
              </thead>
              <tbody>
                {shown.map((c, i) => {
                  const hasPrev = c.prev_total > 0;
                  const pct = hasPrev ? ((c.total - c.prev_total) / c.prev_total) * 100 : 0;
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => router.push(`/risansi/clients/${c.id}`)}
                      style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td data-label="#" style={{ ...TD, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{medal ?? i + 1}</td>
                      <td data-label="" style={{ ...TD, minWidth: 180 }}>
                        <div style={{ fontWeight: 500, color: 'var(--fg)' }}>{c.legal_name}</div>
                        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', marginTop: 1 }}>{c.code}</div>
                      </td>
                      <td data-label="Industry" style={{ ...TD, color: 'var(--fg-2)' }}>{c.industry ?? '—'}</td>
                      <td data-label="State" style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{c.state ?? '—'}</td>
                      <td data-label="Rep" style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{c.rep_name}</td>
                      <td data-label="Pump" style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{c.pump > 0 ? formatRev(c.pump) : '—'}</td>
                      <td data-label="Spare" style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{c.spare > 0 ? formatRev(c.spare) : '—'}</td>
                      <td data-label="Total" style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatRev(c.total)}</td>
                      <td data-label="vs LY" style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: !hasPrev ? 'var(--fg-3)' : pct >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                        {!hasPrev ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`}
                      </td>
                      <td data-label="Tier" style={TD}>
                        {c.tier && (
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
                            background: c.tier === 'Key' ? 'rgba(10,61,143,0.10)' : 'var(--bg-sunk)',
                            color: c.tier === 'Key' ? 'var(--title)' : 'var(--fg-3)',
                          }}>
                            {c.tier}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              Showing {shown.length} of {filtered.length}
            </span>
            {limit < filtered.length && (
              <button
                onClick={() => setLimit(l => l + PAGE)}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', background: 'var(--bg-elev)', color: 'var(--accent)', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer' }}
              >
                Load more
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500, letterSpacing: '-0.005em' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
