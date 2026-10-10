'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';

const MONTH_MAP: Record<string, string> = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
};

function parseMonth(m: string): string | null {
  // Expects "May-2026" or "May 2026"
  const parts = m.trim().split(/[-\s]/);
  if (parts.length < 2) return null;
  const monStr = parts[0].toLowerCase().slice(0, 3);
  const year   = parts[parts.length - 1];
  const mon    = MONTH_MAP[monStr];
  if (!mon || !/^\d{4}$/.test(year)) return null;
  return `${year}-${mon}-01`;
}

interface UploadRow {
  client_code:  string;
  month:        string;
  pump_value:   number;
  spare_value:  number;
}

export async function uploadRevenue(rows: UploadRow[]): Promise<{ inserted: number; skipped: number }> {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? '';
  if (!hasRole(role, 'admin')) throw new Error('Unauthorized');

  let inserted = 0;
  let skipped  = 0;

  for (const row of rows) {
    const monthDate = parseMonth(row.month);
    if (!monthDate) { skipped++; continue; }

    const client = await risansiPool.query<{ id: number }>(
      `SELECT id FROM clients WHERE UPPER(code) = UPPER($1) AND deleted_at IS NULL LIMIT 1`,
      [row.client_code],
    );
    if (!client.rows[0]) { skipped++; continue; }

    const clientId = client.rows[0].id;
    const pump     = Number(row.pump_value)  || 0;
    const spare    = Number(row.spare_value) || 0;
    const total    = pump + spare;

    await risansiPool.query(
      `INSERT INTO client_revenue_monthly
         (client_id, month, pump_value, spare_value, total_value, entered_by, entered_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (client_id, month) DO UPDATE SET
         pump_value  = EXCLUDED.pump_value,
         spare_value = EXCLUDED.spare_value,
         total_value = EXCLUDED.total_value,
         entered_by  = EXCLUDED.entered_by,
         entered_at  = NOW()`,
      [clientId, monthDate, pump, spare, total, session!.user.email],
    );
    inserted++;
  }

  revalidatePath('/risansi/admin/revenue');
  return { inserted, skipped };
}
