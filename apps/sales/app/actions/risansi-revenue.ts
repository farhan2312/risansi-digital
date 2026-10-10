'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';

// Period parsing lives in lib/risansi-revenue-period (a 'use server' file may
// export nothing but async functions).
import { parsePeriod } from '@/lib/risansi-revenue-period';
function parseMonth(raw: string): string | null { return parsePeriod(raw)?.month ?? null; }

// ── uploadRevenue ──────────────────────────────────────────────

export interface UploadPayloadRow {
  client_code: string;
  month:       string;
  pump_value:  number;
  spare_value: number;
  filename:    string;
}

export interface UploadResult {
  inserted:     number;
  updated:      number;
  skipped:      number;
  skippedCodes: string[];
}

export async function uploadRevenue(rows: UploadPayloadRow[]): Promise<UploadResult> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    throw new Error('Unauthorized');
  }

  let inserted = 0;
  let updated  = 0;
  let skipped  = 0;
  const skippedCodes: string[] = [];

  // Open the upload log FIRST, so every revenue row this upload writes can carry
  // its id (upload_id). That is what makes an undo delete exactly this upload's
  // rows and no one else's — see deleteUpload. Counts are filled in at the end.
  const firstMonth = parseMonth(rows[0]?.month ?? '') ?? null;
  let uploadId: number | null = null;
  try {
    const logRow = await risansiPool.query<{ id: number }>(
      `INSERT INTO revenue_upload_log (uploaded_by, filename, month, rows_total, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [session!.user!.email, rows[0]?.filename ?? 'unknown', firstMonth, rows.length],
    );
    uploadId = logRow.rows[0]?.id ?? null;
  } catch { /* revenue_upload_log may not exist — proceed without an undo handle */ }

  // Batch-lookup all client IDs
  const codes = [...new Set(rows.map(r => r.client_code))];
  const clientRes = await risansiPool.query<{ id: string; code: string }>(
    `SELECT id::text, UPPER(code) AS code
     FROM clients
     WHERE UPPER(code) = ANY($1::text[])
       AND deleted_at IS NULL`,
    [codes.map(c => c.toUpperCase())],
  );
  const codeToId: Record<string, string> = {};
  clientRes.rows.forEach(r => { codeToId[r.code] = r.id; });

  for (const row of rows) {
    const clientId  = codeToId[row.client_code.toUpperCase()];
    const period    = parsePeriod(row.month);
    const monthDate = period?.month ?? null;

    if (!clientId || !monthDate) {
      skipped++;
      if (!skippedCodes.includes(row.client_code)) {
        skippedCodes.push(row.client_code);
      }
      continue;
    }

    const pump  = Number(row.pump_value)  || 0;
    const spare = Number(row.spare_value) || 0;
    const total = pump + spare;

    // Check if exists (for count tracking)
    const existing = await risansiPool.query(
      `SELECT id FROM client_revenue_monthly WHERE client_id = $1 AND month = $2`,
      [clientId, monthDate],
    );

    await risansiPool.query(
      `INSERT INTO client_revenue_monthly
         (client_id, month, half, pump_value, spare_value, total_value, entered_by, entered_at, upload_id)
       VALUES ($1, $2, $8, $3, $4, $5, $6, NOW(), $7)
       ON CONFLICT (client_id, month) DO UPDATE SET
         half        = EXCLUDED.half,
         pump_value  = EXCLUDED.pump_value,
         spare_value = EXCLUDED.spare_value,
         total_value = EXCLUDED.total_value,
         entered_by  = EXCLUDED.entered_by,
         entered_at  = NOW(),
         upload_id   = EXCLUDED.upload_id`,
      // ON CONFLICT: the latest upload to touch a (client, month) cell owns it.
      [clientId, monthDate, pump, spare, total, session!.user!.email, uploadId, period?.half ?? null],
    );

    if (existing.rows.length > 0) updated++;
    else inserted++;
  }

  // Finalise the log row opened at the top with the real counts + status.
  if (uploadId != null) {
    const status =
      skipped === rows.length ? 'failed' :
      skipped > 0             ? 'partial' : 'success';
    try {
      await risansiPool.query(
        `UPDATE revenue_upload_log
            SET rows_inserted = $2, rows_updated = $3, rows_skipped = $4,
                skipped_codes = $5, status = $6
          WHERE id = $1`,
        [uploadId, inserted, updated, skipped, skippedCodes, status],
      );
    } catch { /* non-fatal — the revenue rows are already written */ }
  }

  revalidatePath('/risansi/admin/revenue');
  return { inserted, updated, skipped, skippedCodes };
}

// ── deleteUpload ───────────────────────────────────────────────

export async function deleteUpload(logId: number, _month: string): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    throw new Error('Unauthorized');
  }

  // Get log entry
  const logRes = await risansiPool.query<{ uploaded_by: string; month: string }>(
    `SELECT uploaded_by, month FROM revenue_upload_log WHERE id = $1`,
    [logId],
  );
  if (!logRes.rows[0]) throw new Error('Upload log not found');

  // Delete EXACTLY the rows this upload wrote — keyed on upload_id (migration
  // 0048), not on (month, uploaded_by). The old key blew away every row that
  // uploader had ever entered for the month, including a different upload's.
  // Legacy uploads (pre-0048) have no upload_id on their rows, so this removes
  // nothing for them — deliberately safer than guessing which rows were theirs.
  const del = await risansiPool.query(
    `DELETE FROM client_revenue_monthly WHERE upload_id = $1`,
    [logId],
  );

  await risansiPool.query(`DELETE FROM revenue_upload_log WHERE id = $1`, [logId]);

  revalidatePath('/risansi/admin/revenue');
  if ((del.rowCount ?? 0) === 0) {
    // Surface the legacy case so an admin isn't left thinking rows vanished.
    console.warn(`[deleteUpload] log ${logId} removed but 0 revenue rows matched upload_id (legacy pre-0048 upload).`);
  }
}
