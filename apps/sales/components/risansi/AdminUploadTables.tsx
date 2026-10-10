'use client';

// The six tables on the three upload-admin pages — Revenue, Pump Ingestion and
// Outstanding — as client islands, so every column sorts.
//
// All six are complete sets, not pages of a longer query. "Latest 100 entries"
// and "Top 300 by amount" are the whole of what the page fetched and the whole
// of what it claims to show, and none of the three pages has a page-2 link. So
// the sort runs in memory: clicking Total ₹ reorders exactly the rows named in
// the panel heading and the heading stays true. Pushing it into SQL would do
// the opposite — ORDER BY code LIMIT 100 is a different hundred rows, and the
// heading above would still say "latest".
//
// Money and counts sort on the number, never on the "₹1,20,000" the cell
// prints: as text that lands between ₹1 and ₹2.

import type { CSSProperties } from 'react';
import { DEBTOR_BOOK } from '@/lib/risansi-outstanding-debtors';
import { DeleteUploadButton } from '@/components/risansi/DeleteUploadButton';
import { DeletePumpUploadButton } from '@/components/risansi/DeletePumpUploadButton';
import { useTableSort, SortTH } from '@/components/risansi/SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';

// ── An upload's outcome ────────────────────────────────────────
//
// The sequence a log row travels, exactly as the three upload actions derive
// it (app/actions/risansi-revenue.ts and its pump and outstanding siblings): a
// row is written 'pending', and finishes 'failed' when every line was skipped,
// 'partial' when some were, 'success' when none were. Ordering it that way also
// puts the runs that went wrong at the top, which is the only reason anybody
// clicks this column. Alphabetically it would open on 'failed' then 'partial'
// then 'pending' then 'success', which says nothing.
const UPLOAD_STATUS_ORDER = ['pending', 'failed', 'partial', 'success'];

// ── Formatters ─────────────────────────────────────────────────
// Deliberate copies of the ones on the pages these tables came from. A client
// island cannot borrow a helper from a server component, and these are three
// lines each; the alternative is threading a formatted string through every row.

const fmtMonth = (raw: unknown): string => {
  if (!raw) return '—';
  try {
    return new Date(String(raw)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  } catch { return String(raw); }
};
const fmtDay = (raw: unknown) => raw
  ? new Date(String(raw)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—';
const fmtWhen = (raw: string, withYear = true) => new Date(raw).toLocaleString('en-IN',
  withYear
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const plainInr = (n: number) => (!n || n === 0) ? '—' : n.toLocaleString('en-IN');
const rupeeInr = (n: number) => (!n || n === 0) ? '—' : `₹${n.toLocaleString('en-IN')}`;

// ── Row shapes ─────────────────────────────────────────────────

export interface RevenueLogRow {
  id: number; uploaded_by: string; filename: string; month: string | null;
  rows_total: number; rows_inserted: number; rows_updated: number; rows_skipped: number;
  skipped_codes: string[] | null; status: string; uploaded_at: string;
}

export interface RevenueEntryRow {
  id: string; month: string;
  pump_value: number; spare_value: number; total_value: number;
  entered_by: string | null; entered_at: string | null;
  code: string; legal_name: string; industry: string | null; state: string | null;
}

export interface PumpLogRow {
  id: number; uploaded_by: string; filename: string;
  rows_total: number; rows_inserted: number; rows_updated: number; rows_skipped: number;
  skipped_codes: string[] | null; status: string; uploaded_at: string;
}

export interface PumpEntryRow {
  id: string;
  pump_model_plate: string | null; pump_sl_no: string | null;
  ec_number: string | null; so_number: string | null;
  liquid: string | null; capacity: string | null; head: string | null;
  supplier: string | null;
  code: string; legal_name: string; entered_by: string | null;
}

export interface OutstandingLogRow {
  id: number; uploaded_by: string; filename: string; as_of_date: string | null;
  rows_total: number; rows_matched: number; rows_skipped: number; skipped_codes: string[] | null;
  grand_total: number | null; status: string; uploaded_at: string;
}

export interface OutstandingRow {
  code: string; legal_name: string; amount: number;
  debtor: string | null; owner: string | null; as_of: string | null;
}

// ── Revenue · upload history ───────────────────────────────────

const REVENUE_LOG_COLS: SortableColumn<RevenueLogRow>[] = [
  { key: 'uploaded_at',   kind: 'date' },
  { key: 'filename',      kind: 'text' },
  { key: 'month',         kind: 'date' },
  { key: 'rows_total',    kind: 'number' },
  { key: 'rows_inserted', kind: 'number' },
  { key: 'rows_updated',  kind: 'number' },
  { key: 'rows_skipped',  kind: 'number' },
  { key: 'status',        kind: 'status', order: UPLOAD_STATUS_ORDER },
  { key: 'uploaded_by',   kind: 'text' },
];

export function RevenueUploadLogTable({ rows }: { rows: RevenueLogRow[] }) {
  const { rows: shown, sortBy } = useTableSort(rows, REVENUE_LOG_COLS);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={TABLE}>
        <thead>
          <tr style={{ background: 'var(--bg-elev)' }}>
            <SortTH {...sortBy('uploaded_at')}   style={TH}>Date &amp; Time</SortTH>
            <SortTH {...sortBy('filename')}      style={TH}>File</SortTH>
            <SortTH {...sortBy('month')}         style={TH}>Month</SortTH>
            <SortTH {...sortBy('rows_total')}    style={TH_C}>Rows</SortTH>
            <SortTH {...sortBy('rows_inserted')} style={TH_C}>Inserted</SortTH>
            <SortTH {...sortBy('rows_updated')}  style={TH_C}>Updated</SortTH>
            <SortTH {...sortBy('rows_skipped')}  style={TH_C}>Skipped</SortTH>
            <SortTH {...sortBy('status')}        style={TH}>Status</SortTH>
            <SortTH {...sortBy('uploaded_by')}   style={TH}>Uploaded By</SortTH>
            {/* The undo button. */}
            <th style={TH}>Action</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((log, i) => (
            <tr key={log.id} style={rowRule(i, shown.length)}>
              <td style={{ ...TD, ...MONO, whiteSpace: 'nowrap' }}>{fmtWhen(log.uploaded_at)}</td>
              <td style={FILE_TD}>{log.filename}</td>
              <td style={{ ...TD, ...MONO }}>{fmtMonth(log.month)}</td>
              <td style={{ ...TD, textAlign: 'center' }}>{log.rows_total}</td>
              <td style={{ ...TD, textAlign: 'center', color: 'var(--pos-strong)', fontWeight: 600 }}>{log.rows_inserted}</td>
              <td style={{ ...TD, textAlign: 'center', color: 'var(--accent)' }}>{log.rows_updated}</td>
              <SkippedCell n={log.rows_skipped} codes={log.skipped_codes} />
              <td style={TD}><StatusPill status={log.status} /></td>
              <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{log.uploaded_by}</td>
              <td style={TD}><DeleteUploadButton logId={log.id} month={log.month ?? ''} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Revenue · the entries themselves ───────────────────────────

const REVENUE_ENTRY_COLS: SortableColumn<RevenueEntryRow>[] = [
  { key: 'month',       kind: 'date' },
  { key: 'code',        kind: 'text' },
  { key: 'legal_name',  kind: 'text' },
  { key: 'industry',    kind: 'text' },
  { key: 'state',       kind: 'text' },
  { key: 'pump_value',  kind: 'number' },
  { key: 'spare_value', kind: 'number' },
  { key: 'total_value', kind: 'number' },
  { key: 'entered_by',  kind: 'text' },
];

export function RevenueEntriesTable({ rows }: { rows: RevenueEntryRow[] }) {
  const { rows: shown, sortBy } = useTableSort(rows, REVENUE_ENTRY_COLS);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={TABLE}>
        <thead>
          <tr style={{ background: 'var(--bg-elev)' }}>
            <SortTH {...sortBy('month')}       style={TH}>Month</SortTH>
            <SortTH {...sortBy('code')}        style={TH}>Client Code</SortTH>
            <SortTH {...sortBy('legal_name')}  style={TH}>Client Name</SortTH>
            <SortTH {...sortBy('industry')}    style={TH}>Industry</SortTH>
            <SortTH {...sortBy('state')}       style={TH}>State</SortTH>
            <SortTH {...sortBy('pump_value')}  style={TH_R} align="right">Pump ₹</SortTH>
            <SortTH {...sortBy('spare_value')} style={TH_R} align="right">Spare ₹</SortTH>
            <SortTH {...sortBy('total_value')} style={TH_R} align="right">Total ₹</SortTH>
            <SortTH {...sortBy('entered_by')}  style={TH}>Entered By</SortTH>
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={row.id} style={rowRule(i, shown.length)}>
              <td style={{ ...TD, ...MONO, whiteSpace: 'nowrap' }}>{fmtMonth(row.month)}</td>
              <td style={{ ...TD, ...MONO, color: 'var(--fg-3)' }}>{row.code}</td>
              <td style={{ ...TD, minWidth: 160 }}><ClientLink code={row.code} name={row.legal_name} /></td>
              <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.industry ?? '—'}</td>
              <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.state ?? '—'}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{plainInr(row.pump_value)}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{plainInr(row.spare_value)}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{plainInr(row.total_value)}</td>
              <td style={{ ...TD, fontSize: 11, color: 'var(--fg-3)' }}>{row.entered_by ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Pumps · upload history ─────────────────────────────────────

const PUMP_LOG_COLS: SortableColumn<PumpLogRow>[] = [
  { key: 'uploaded_at',   kind: 'date' },
  { key: 'filename',      kind: 'text' },
  { key: 'rows_total',    kind: 'number' },
  { key: 'rows_inserted', kind: 'number' },
  { key: 'rows_updated',  kind: 'number' },
  { key: 'rows_skipped',  kind: 'number' },
  { key: 'status',        kind: 'status', order: UPLOAD_STATUS_ORDER },
  { key: 'uploaded_by',   kind: 'text' },
];

export function PumpUploadLogTable({ rows }: { rows: PumpLogRow[] }) {
  const { rows: shown, sortBy } = useTableSort(rows, PUMP_LOG_COLS);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={TABLE}>
        <thead>
          <tr style={{ background: 'var(--bg-elev)' }}>
            <SortTH {...sortBy('uploaded_at')}   style={TH}>Date &amp; Time</SortTH>
            <SortTH {...sortBy('filename')}      style={TH}>File</SortTH>
            <SortTH {...sortBy('rows_total')}    style={TH_C}>Rows</SortTH>
            <SortTH {...sortBy('rows_inserted')} style={TH_C}>Inserted</SortTH>
            <SortTH {...sortBy('rows_updated')}  style={TH_C}>Updated</SortTH>
            <SortTH {...sortBy('rows_skipped')}  style={TH_C}>Skipped</SortTH>
            <SortTH {...sortBy('status')}        style={TH}>Status</SortTH>
            <SortTH {...sortBy('uploaded_by')}   style={TH}>Uploaded By</SortTH>
            {/* The undo button. */}
            <th style={TH}>Action</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((log, i) => (
            <tr key={log.id} style={rowRule(i, shown.length)}>
              <td style={{ ...TD, ...MONO, whiteSpace: 'nowrap' }}>{fmtWhen(log.uploaded_at)}</td>
              <td style={FILE_TD}>{log.filename}</td>
              <td style={{ ...TD, textAlign: 'center' }}>{log.rows_total}</td>
              <td style={{ ...TD, textAlign: 'center', color: 'var(--pos-strong)', fontWeight: 600 }}>{log.rows_inserted}</td>
              <td style={{ ...TD, textAlign: 'center', color: 'var(--accent)' }}>{log.rows_updated}</td>
              <SkippedCell n={log.rows_skipped} codes={log.skipped_codes} />
              <td style={TD}><StatusPill status={log.status} /></td>
              <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{log.uploaded_by}</td>
              <td style={TD}><DeletePumpUploadButton logId={log.id} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Pumps · the entries themselves ─────────────────────────────

// Capacity and Head are text columns that usually hold a figure with its unit
// ("120 m3/hr"). They sort as text on purpose, and the comparator reads the
// numerals inside, so 20 still comes before 100 rather than after it.
const PUMP_ENTRY_COLS: SortableColumn<PumpEntryRow>[] = [
  { key: 'code',             kind: 'text' },
  { key: 'legal_name',       kind: 'text' },
  { key: 'pump_model_plate', kind: 'text' },
  { key: 'pump_sl_no',       kind: 'text' },
  { key: 'ec_number',        kind: 'text' },
  { key: 'so_number',        kind: 'text' },
  { key: 'liquid',           kind: 'text' },
  { key: 'capacity',         kind: 'text' },
  { key: 'head',             kind: 'text' },
  { key: 'supplier',         kind: 'text' },
  { key: 'entered_by',       kind: 'text' },
];

export function PumpEntriesTable({ rows }: { rows: PumpEntryRow[] }) {
  const { rows: shown, sortBy } = useTableSort(rows, PUMP_ENTRY_COLS);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={TABLE}>
        <thead>
          <tr style={{ background: 'var(--bg-elev)' }}>
            <SortTH {...sortBy('code')}             style={TH}>Client Code</SortTH>
            <SortTH {...sortBy('legal_name')}       style={TH}>Client Name</SortTH>
            <SortTH {...sortBy('pump_model_plate')} style={TH}>Model</SortTH>
            <SortTH {...sortBy('pump_sl_no')}       style={TH}>SR No</SortTH>
            <SortTH {...sortBy('ec_number')}        style={TH}>EC No</SortTH>
            <SortTH {...sortBy('so_number')}        style={TH}>SO No</SortTH>
            <SortTH {...sortBy('liquid')}           style={TH}>Liquid</SortTH>
            <SortTH {...sortBy('capacity')}         style={TH}>Capacity</SortTH>
            <SortTH {...sortBy('head')}             style={TH}>Head</SortTH>
            <SortTH {...sortBy('supplier')}         style={TH}>Supplier</SortTH>
            <SortTH {...sortBy('entered_by')}       style={TH}>Entered By</SortTH>
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={row.id} style={rowRule(i, shown.length)}>
              <td style={{ ...TD, ...MONO, color: 'var(--fg-3)' }}>{row.code}</td>
              <td style={{ ...TD, minWidth: 160 }}><ClientLink code={row.code} name={row.legal_name} /></td>
              <td style={{ ...TD, ...MONO, fontWeight: 600 }}>{row.pump_model_plate ?? '—'}</td>
              <td style={{ ...TD, ...MONO }}>{row.pump_sl_no ?? '—'}</td>
              <td style={{ ...TD, ...MONO }}>{row.ec_number ?? '—'}</td>
              <td style={{ ...TD, ...MONO }}>{row.so_number ?? '—'}</td>
              <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.liquid ?? '—'}</td>
              <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.capacity ?? '—'}</td>
              <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.head ?? '—'}</td>
              <td style={{ ...TD, color: 'var(--fg-3)' }}>{row.supplier ?? '—'}</td>
              <td style={{ ...TD, fontSize: 11, color: 'var(--fg-3)' }}>{row.entered_by ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Outstanding · upload history ───────────────────────────────

const OUTSTANDING_LOG_COLS: SortableColumn<OutstandingLogRow>[] = [
  { key: 'uploaded_at',  kind: 'date' },
  { key: 'filename',     kind: 'text' },
  { key: 'as_of_date',   kind: 'date' },
  { key: 'rows_total',   kind: 'number' },
  { key: 'rows_matched', kind: 'number' },
  { key: 'rows_skipped', kind: 'number' },
  { key: 'grand_total',  kind: 'number' },
  { key: 'status',       kind: 'status', order: UPLOAD_STATUS_ORDER },
  { key: 'uploaded_by',  kind: 'text' },
];

export function OutstandingUploadLogTable({ rows }: { rows: OutstandingLogRow[] }) {
  const { rows: shown, sortBy } = useTableSort(rows, OUTSTANDING_LOG_COLS);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={TABLE}>
        <thead>
          <tr style={{ background: 'var(--bg-elev)' }}>
            <SortTH {...sortBy('uploaded_at')}  style={TH}>Date</SortTH>
            <SortTH {...sortBy('filename')}     style={TH}>File</SortTH>
            <SortTH {...sortBy('as_of_date')}   style={TH}>As Of</SortTH>
            <SortTH {...sortBy('rows_total')}   style={TH_C}>Rows</SortTH>
            <SortTH {...sortBy('rows_matched')} style={TH_C}>Matched</SortTH>
            <SortTH {...sortBy('rows_skipped')} style={TH_C}>Skipped</SortTH>
            <SortTH {...sortBy('grand_total')}  style={TH_R} align="right">Total ₹</SortTH>
            <SortTH {...sortBy('status')}       style={TH}>Status</SortTH>
            <SortTH {...sortBy('uploaded_by')}  style={TH}>By</SortTH>
          </tr>
        </thead>
        <tbody>
          {shown.map((l, i) => (
            <tr key={l.id} style={rowRule(i, shown.length)}>
              <td style={{ ...TD, ...MONO, whiteSpace: 'nowrap' }}>{fmtWhen(l.uploaded_at, false)}</td>
              <td style={{ ...FILE_TD, maxWidth: 150 }}>{l.filename}</td>
              <td style={{ ...TD, ...MONO }}>{fmtDay(l.as_of_date)}</td>
              <td style={{ ...TD, textAlign: 'center' }}>{l.rows_total}</td>
              <td style={{ ...TD, textAlign: 'center', color: 'var(--pos-strong)', fontWeight: 600 }}>{l.rows_matched}</td>
              <SkippedCell n={l.rows_skipped} codes={l.skipped_codes} />
              <td style={{ ...TD, ...MONO, textAlign: 'right' }}>{rupeeInr(l.grand_total ?? 0)}</td>
              <td style={TD}><StatusPill status={l.status} /></td>
              <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{l.uploaded_by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Outstanding · the current book ─────────────────────────────

/** Who the receivable sits with, as the cell prints it: the named owner when
 *  there is one, otherwise whoever the debtor book maps that code to. Sorting
 *  the raw owner column would have left every fallback row blank and sunk it. */
const ownerOf = (r: OutstandingRow): string =>
  r.owner ?? (r.debtor ? DEBTOR_BOOK[r.debtor] ?? r.debtor : '');

const OUTSTANDING_COLS: SortableColumn<OutstandingRow>[] = [
  { key: 'code',       kind: 'text' },
  { key: 'legal_name', kind: 'text' },
  { key: 'debtor',     kind: 'text' },
  { key: 'owner',      kind: 'text', value: ownerOf },
  { key: 'amount',     kind: 'number' },
  { key: 'as_of',      kind: 'date' },
];

export function OutstandingCurrentTable({ rows }: { rows: OutstandingRow[] }) {
  const { rows: shown, sortBy } = useTableSort(rows, OUTSTANDING_COLS);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={TABLE}>
        <thead>
          <tr style={{ background: 'var(--bg-elev)' }}>
            <SortTH {...sortBy('code')}       style={TH}>Code</SortTH>
            <SortTH {...sortBy('legal_name')} style={TH}>Client</SortTH>
            <SortTH {...sortBy('debtor')}     style={TH}>Debtor</SortTH>
            <SortTH {...sortBy('owner')}      style={TH}>Owner</SortTH>
            <SortTH {...sortBy('amount')}     style={TH_R} align="right">Outstanding ₹</SortTH>
            <SortTH {...sortBy('as_of')}      style={TH}>As Of</SortTH>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.code + i} style={rowRule(i, shown.length)}>
              <td style={{ ...TD, ...MONO, color: 'var(--fg-3)' }}>{r.code}</td>
              <td style={{ ...TD, minWidth: 180 }}><ClientLink code={r.code} name={r.legal_name} /></td>
              <td style={{ ...TD, ...MONO, color: 'var(--fg-3)' }}>{r.debtor ?? '—'}</td>
              <td style={{ ...TD, color: 'var(--fg-2)' }}>{ownerOf(r) || '—'}</td>
              <td style={{ ...TD, ...MONO, textAlign: 'right', fontWeight: 600, color: 'var(--neg)' }}>{rupeeInr(r.amount)}</td>
              <td style={{ ...TD, ...MONO, fontSize: 11 }}>{fmtDay(r.as_of)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared cells ───────────────────────────────────────────────

function ClientLink({ code, name }: { code: string; name: string }) {
  return <a href={`/risansi/clients/${code}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>{name}</a>;
}

function SkippedCell({ n, codes }: { n: number; codes: string[] | null }) {
  return (
    <td style={{ ...TD, textAlign: 'center', color: n > 0 ? 'var(--neg-strong)' : 'var(--fg-3)' }}>
      {n}
      {(codes?.length ?? 0) > 0 && (
        <span title={(codes ?? []).join(', ')} style={{ cursor: 'help' }}> ⓘ</span>
      )}
    </td>
  );
}

function StatusPill({ status }: { status: string }) {
  const [bg, fg] = status === 'success' ? ['var(--pos-soft)', 'var(--pos-strong)']
    : status === 'partial' ? ['var(--warn-soft)', 'var(--warn)']
    : status === 'pending' ? ['var(--bg-sunk)', 'var(--fg-3)']
    : ['var(--neg-soft)', 'var(--neg-strong)'];
  return (
    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: bg, color: fg }}>
      {status}
    </span>
  );
}

// ── Styles ─────────────────────────────────────────────────────
// The same objects the three pages used, so nothing about these tables looks
// different from the day before they could be sorted.

const TABLE: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase',
  letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)',
  borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)',
};
const TH_C: CSSProperties = { ...TH, textAlign: 'center' };
const TH_R: CSSProperties = { ...TH, textAlign: 'right' };
const TD: CSSProperties = { padding: '9px 12px', verticalAlign: 'middle' };
const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11 };
const FILE_TD: CSSProperties = {
  ...TD, ...MONO, color: 'var(--fg-3)', maxWidth: 160,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const rowRule = (i: number, n: number): CSSProperties => ({
  borderBottom: i < n - 1 ? '1px solid var(--line)' : 'none',
});
