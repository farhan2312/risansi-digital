import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient } from '@/lib/risansi-auth';

// Pumps for one client, used by the visit-form pump editor.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = parseInt(searchParams.get('clientId') ?? '', 10);
  if (!Number.isInteger(clientId)) return NextResponse.json({ pumps: [] });

  const user = await getCurrentUser();
  if (!(await canViewClient(user, clientId))) {
    return NextResponse.json({ pumps: [] }, { status: 403 });
  }

  const { rows } = await risansiPool.query(
    `SELECT id, pump_model_plate, pump_sl_no, ec_number, so_number, liquid, capacity, head, batch_id::text AS batch_id
     FROM client_pumps WHERE client_id = $1 ORDER BY id`,
    [clientId],
  );
  return NextResponse.json({ pumps: rows });
}
