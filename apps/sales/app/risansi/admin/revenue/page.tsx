import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { RevenueUploadBox } from '@/components/risansi/RevenueUploadBox';
import {
  RevenueUploadLogTable, RevenueEntriesTable,
  type RevenueLogRow, type RevenueEntryRow,
} from '@/components/risansi/AdminUploadTables';

// ── Helpers ────────────────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) {
    console.error('[revenue/page] query error:', err);
    return fallback;
  }
}

// ── Types ──────────────────────────────────────────────────────
//
// Both tables moved to AdminUploadTables, which owns their row shapes now —
// every column there sorts, and that needs a client component. Neither table
// is paginated: the queries below fetch the whole of what the page shows, so
// the sort happens in memory and the panel headings stay true.

type RevenueRow = RevenueEntryRow;
type LogRow = RevenueLogRow;

// ── Page ──────────────────────────────────────────────────────

export default async function RevenueAdminPage() {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? '';
  if (!['admin', 'sysadmin'].includes(role)) redirect('/risansi');

  const [revenueHistory, uploadLog] = await Promise.all([

    q<RevenueRow[]>(async () => {
      const { rows } = await risansiPool.query<RevenueRow>(
        `SELECT
           crm.id::text,
           crm.month::text,
           crm.pump_value::float  AS pump_value,
           crm.spare_value::float AS spare_value,
           crm.total_value::float AS total_value,
           crm.entered_by,
           crm.entered_at::text   AS entered_at,
           c.code,
           c.legal_name,
           c.industry,
           c.state
         FROM client_revenue_monthly crm
         JOIN clients c ON crm.client_id = c.id
         ORDER BY crm.month DESC, crm.total_value DESC
         LIMIT 100`,
      );
      return rows;
    }, []),

    q<LogRow[]>(async () => {
      const { rows } = await risansiPool.query<LogRow>(
        `SELECT *
         FROM revenue_upload_log
         ORDER BY uploaded_at DESC
         LIMIT 20`,
      );
      return rows;
    }, []),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Admin', 'Revenue Upload']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Revenue Upload
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            Upload monthly revenue data from Excel
          </div>
        </div>

        {/* ── Section 1: Template Download ─────────────────────── */}
        <div style={{ ...PANEL, padding: '20px 24px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>
                Revenue Upload Template
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
                Download the template, fill in revenue data, then upload below. One file per month.
              </div>
              <div style={{
                marginTop: 10, fontSize: 12, color: 'var(--fg-3)',
                fontFamily: 'var(--font-mono)',
                background: 'var(--bg-elev)', padding: '8px 12px',
                borderRadius: 6, display: 'inline-block', lineHeight: 1.8,
              }}>
                Columns: Client Code | Client Name | Month | Pump Value | Spare Value
                <br />
                Month format: May-2026 · Values in ₹ INR · No commas or symbols
              </div>
            </div>
            <a
              href="/revenue_upload_template.xlsx"
              download
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', background: 'var(--accent-fill)', color: 'var(--on-accent)',
                borderRadius: 7, textDecoration: 'none',
                fontSize: 13, fontWeight: 500,
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              ⬇ Download Template
            </a>
          </div>
        </div>

        {/* ── Section 2: Upload Box (client island) ────────────── */}
        <RevenueUploadBox />

        {/* ── Section 3: Upload History Log ────────────────────── */}
        <div style={{ ...PANEL, marginBottom: 16 }}>
          <div style={{
            padding: '12px 20px', borderBottom: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Upload History</span>
          </div>

          {uploadLog.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
              No uploads yet
            </div>
          ) : (
            <RevenueUploadLogTable rows={uploadLog} />
          )}
        </div>

        {/* ── Section 4: Revenue Data Table ────────────────────── */}
        <div style={PANEL}>
          <div style={{
            padding: '12px 20px', borderBottom: '1px solid var(--line)',
            fontSize: 13, fontWeight: 600,
          }}>
            Recent Revenue Entries
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-3)', fontWeight: 400 }}>
              Latest 100 entries
            </span>
          </div>

          {revenueHistory.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
              No revenue data uploaded yet
            </div>
          ) : (
            <RevenueEntriesTable rows={revenueHistory} />
          )}
        </div>

      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
};
