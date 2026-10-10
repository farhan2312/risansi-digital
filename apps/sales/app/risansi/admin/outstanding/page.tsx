import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { OutstandingUploadBox } from '@/components/risansi/OutstandingUploadBox';
import {
  OutstandingUploadLogTable, OutstandingCurrentTable,
  type OutstandingLogRow, type OutstandingRow,
} from '@/components/risansi/AdminUploadTables';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[outstanding/page]', err); return fallback; }
}
const fmtDate = (raw: unknown) => raw ? new Date(String(raw)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtInr  = (n: number) => (!n || n === 0) ? '—' : `₹${n.toLocaleString('en-IN')}`;

interface Summary { clients: number; total: number; as_of: string | null; }
// Both tables moved to AdminUploadTables so their columns can sort. Neither is
// paginated — "Top 300 by amount" is the whole of what the query returns — so
// the sort runs in memory over exactly those rows and the heading stays true.
type LogRow = OutstandingLogRow;
type OutRow = OutstandingRow;

export default async function OutstandingAdminPage() {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? '';
  if (!['admin', 'sysadmin'].includes(role)) redirect('/risansi');

  const [summary, log, current] = await Promise.all([
    q<Summary>(async () => (await risansiPool.query<Summary>(
      `SELECT count(*)::int AS clients, COALESCE(sum(total_outstanding),0)::float AS total, max(outstanding_as_of)::text AS as_of
         FROM clients WHERE total_outstanding IS NOT NULL AND deleted_at IS NULL`)).rows[0], { clients: 0, total: 0, as_of: null }),
    q<LogRow[]>(async () => (await risansiPool.query<LogRow>(
      `SELECT id, uploaded_by, filename, as_of_date::text, rows_total, rows_matched, rows_skipped,
              skipped_codes, grand_total::float, status, uploaded_at::text
         FROM outstanding_upload_log ORDER BY uploaded_at DESC LIMIT 20`)).rows, []),
    q<OutRow[]>(async () => (await risansiPool.query<OutRow>(
      `SELECT c.code, c.legal_name, c.total_outstanding::float AS amount,
              c.outstanding_debtor_code AS debtor, u.name AS owner, c.outstanding_as_of::text AS as_of
         FROM clients c LEFT JOIN users u ON u.id = c.outstanding_owner_id
        WHERE c.total_outstanding IS NOT NULL AND c.deleted_at IS NULL
        ORDER BY c.total_outstanding DESC LIMIT 300`)).rows, []),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}><Topbar crumbs={['Admin', 'Outstanding Upload']} /></div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Outstanding Upload</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>Monthly receivables snapshot — each upload replaces the previous one</div>
        </div>

        {/* Current snapshot */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
          <div style={{ ...PANEL, padding: '14px 16px' }}>
            <div style={LBL}>Total Outstanding</div>
            <div style={{ ...VAL, color: 'var(--neg)' }}>{fmtInr(summary.total)}</div>
          </div>
          <div style={{ ...PANEL, padding: '14px 16px' }}>
            <div style={LBL}>Clients With Outstanding</div>
            <div style={VAL}>{summary.clients.toLocaleString('en-IN')}</div>
          </div>
          <div style={{ ...PANEL, padding: '14px 16px' }}>
            <div style={LBL}>As Of</div>
            <div style={{ ...VAL, fontSize: 20 }}>{fmtDate(summary.as_of)}</div>
          </div>
        </div>

        {/* Template */}
        <div style={{ ...PANEL, padding: '20px 24px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Outstanding Upload Template</div>
            <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>Download, fill in this month's figures, then upload below. One file per month — it replaces the last.</div>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', background: 'var(--bg-elev)', padding: '8px 12px', borderRadius: 6, display: 'inline-block', lineHeight: 1.8 }}>
              Columns: Subledger Code | Debtor | Name | Total Outstanding<br />Amount in ₹ INR · matched on subledger (client) code
            </div>
          </div>
          <a href="/outstanding_upload_template.xlsx" download
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'var(--accent-fill)', color: 'var(--on-accent)', borderRadius: 7, textDecoration: 'none', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
            ⬇ Download Template
          </a>
        </div>

        {/* Upload box */}
        <OutstandingUploadBox />

        {/* Upload history */}
        <div style={{ ...PANEL, marginBottom: 16 }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 600 }}>Upload History</div>
          {log.length === 0 ? <div style={EMPTY}>No uploads yet</div> : <OutstandingUploadLogTable rows={log} />}
        </div>

        {/* Current outstanding data */}
        <div style={PANEL}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 600 }}>
            Current Outstanding <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-3)', fontWeight: 400 }}>Top 300 by amount</span>
          </div>
          {current.length === 0
            ? <div style={EMPTY}>No outstanding data — upload a sheet above.</div>
            : <OutstandingCurrentTable rows={current} />}
        </div>

      </div>
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const LBL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', fontWeight: 600 };
const VAL: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, color: 'var(--fg)', marginTop: 4, lineHeight: 1.1 };
const EMPTY: CSSProperties = { padding: 32, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 };
