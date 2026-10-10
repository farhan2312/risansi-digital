import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';

export const runtime = 'nodejs';

// GET — full client record + its contacts, for pre-filling the edit drawer on the
// Client Master page. Admin/sysadmin only (that page is admin-gated).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clientId = parseInt(id, 10);
  if (!Number.isInteger(clientId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const user = await getCurrentUser();
  if (!hasRole(user.role, 'admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const client = (await risansiPool.query(
    `SELECT id, code, legal_name, trade_name, group_name, industry, is_sugar, google_maps_url,
            tour_id, primary_rep_id,
            -- The form replaces the covering list wholesale, so it has to open
            -- holding the current one; without this an edit for any other reason
            -- would silently clear every covering rep on save.
            COALESCE((SELECT array_agg(s.rep_id) FROM client_secondary_reps s
                       WHERE s.client_id = clients.id), '{}') AS secondary_rep_ids,
            client_type, market_type, is_tender, is_end_client, capacity_bracket,
            tcd, klpd, status, tier, since_year, country, state, city, address
       FROM clients WHERE id = $1 AND deleted_at IS NULL`,
    [clientId],
  )).rows[0];
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const contacts = (await risansiPool.query(
    `SELECT id, name, designation, phone, email, whatsapp, is_primary
       FROM contacts WHERE client_id = $1 ORDER BY is_primary DESC, created_at ASC`,
    [clientId],
  )).rows;

  return NextResponse.json({ client, contacts });
}
