import type { CSSProperties } from 'react';
import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { PumpUploadBox } from '@/components/risansi/PumpUploadBox';
import {
  PumpUploadLogTable, PumpEntriesTable,
  type PumpLogRow, type PumpEntryRow,
} from '@/components/risansi/AdminUploadTables';

// ── Helpers ────────────────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) {
    console.error('[admin/pumps] query error:', err);
    return fallback;
  }
}

// ── Types ──────────────────────────────────────────────────────
//
// Both tables now live in AdminUploadTables, which owns their row shapes:
// sorting every column needs client state, and neither table is a page of a
// longer query, so the sort runs in memory over exactly the rows fetched here.

type PumpRow = PumpEntryRow;
type LogRow = PumpLogRow;

// ── Page ──────────────────────────────────────────────────────

export default async function PumpAdminPage() {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? '';
  if (!['admin', 'sysadmin'].includes(role)) redirect('/risansi');

  const [pumpHistory, uploadLog] = await Promise.all([

    q<PumpRow[]>(async () => {
      const { rows } = await risansiPool.query<PumpRow>(
        `SELECT
           cp.id::text,
           cp.pump_model_plate,
           cp.pump_sl_no,
           cp.ec_number,
           cp.so_number,
           cp.liquid,
           cp.capacity,
           cp.head,
           cp.customer_name AS supplier,
           c.code,
           c.legal_name,
           cp.entered_by
         FROM client_pumps cp
         JOIN clients c ON cp.client_id = c.id
         WHERE cp.source = 'upload'
         ORDER BY cp.entered_at DESC NULLS LAST, cp.id DESC
         LIMIT 100`,
      );
      return rows;
    }, []),

    q<LogRow[]>(async () => {
      const { rows } = await risansiPool.query<LogRow>(
        `SELECT * FROM pump_upload_log ORDER BY uploaded_at DESC LIMIT 20`,
      );
      return rows;
    }, []),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Admin', 'Pump Ingestion']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Pump Ingestion
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            Upload newly installed pumps per client from Excel — appears in each client&apos;s Client 360 pump list
          </div>
        </div>

        {/* ── Section 1: Template Download ─────────────────────── */}
        <div style={{ ...PANEL, padding: '20px 24px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>
                Pump Upload Template
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
                Download the template, add the month&apos;s newly installed pumps (one row per pump), then upload below.
              </div>
              <div style={{
                marginTop: 10, fontSize: 12, color: 'var(--fg-3)',
                fontFamily: 'var(--font-mono)', background: 'var(--bg-elev)',
                padding: '8px 12px', borderRadius: 6, display: 'inline-block', lineHeight: 1.8,
              }}>
                Columns: CUST | CUST_NAME | EC_NO | SO_NO | PUMP_SL_NO | PUMP_MODEL_AS_NAME_PLATE | LIQUID | CAPACITY | HEAD
                <br />
                CUST is the ERP customer code (reversed to the portal code) · Re-uploading the same serial updates that pump
              </div>
            </div>
            <a
              href="/pump_upload_template.xlsx"
              download
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', background: 'var(--accent-fill)', color: 'var(--on-accent)',
                borderRadius: 7, textDecoration: 'none', fontSize: 13, fontWeight: 500,
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              ⬇ Download Template
            </a>
          </div>
        </div>

        {/* ── Section 2: Upload Box (client island) ────────────── */}
        <PumpUploadBox />

        {/* ── Section 3: Upload History Log ────────────────────── */}
        <div style={{ ...PANEL, marginBottom: 16 }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 600 }}>
            Upload History
          </div>

          {uploadLog.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>No uploads yet</div>
          ) : (
            <PumpUploadLogTable rows={uploadLog} />
          )}
        </div>

        {/* ── Section 4: Recent Pump Entries ───────────────────── */}
        <div style={PANEL}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 600 }}>
            Recently Uploaded Pumps
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-3)', fontWeight: 400 }}>Latest 100 entries</span>
          </div>

          {pumpHistory.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>No pumps uploaded yet</div>
          ) : (
            <PumpEntriesTable rows={pumpHistory} />
          )}
        </div>

      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
};

