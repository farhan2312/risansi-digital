import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientVisibilitySql } from '@/lib/risansi-auth';

export const runtime = 'nodejs';

/**
 * Overdue ACTIVE clients the signed-in user can see (no visit in 90+ days, or
 * never visited), most-overdue first. Used to seed the Plan Visit form with
 * recommended accounts so a rep can pick one without searching. Scoped by the
 * same visibility rules as the rest of the app (a rep sees only their own).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user.email) return NextResponse.json([], { status: 401 });

  const cVis = clientVisibilitySql(user, 'c');     // null for admins (no limit)
  const cAnd = cVis ? ` AND (${cVis})` : '';

  const { rows } = await risansiPool.query<{
    id: string; code: string; legal_name: string;
    city: string | null; state: string | null; industry: string | null;
    days_since: number | null;
  }>(
    `SELECT c.id::text, c.code, c.legal_name, c.city, c.state, c.industry,
            COALESCE(EXTRACT(DAY FROM NOW() - c.last_visit_date)::int, NULL) AS days_since
       FROM clients c
      WHERE c.status = 'ACTIVE' AND c.deleted_at IS NULL
        AND (c.last_visit_date IS NULL OR c.last_visit_date < CURRENT_DATE - INTERVAL '90 days')${cAnd}
      ORDER BY c.last_visit_date ASC NULLS FIRST
      LIMIT 20`,
  );

  return NextResponse.json(rows);
}
