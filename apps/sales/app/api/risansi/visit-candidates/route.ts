import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

// Who may be given a visit to this client.
//
//   GET /api/risansi/visit-candidates?clientId=123
//   → { ids: ['4', '9', '12'], owner: 'Akshay Awasthi' | null, covering: ['…'] }
//
// The same answer whyCannotVisitClient gives after the fact, offered before it:
// the Plan Visit drawer narrows its rep list to these, so an admin is not shown
// a choice the save is going to refuse. Owner, covering reps, the managers of
// either, and admins — who may be sent anywhere. `ids` are text so the drawer's
// String(id) comparisons hold.
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ ids: [], owner: null, covering: [] }, { status: 401 });

    const clientId = parseInt(new URL(request.url).searchParams.get('clientId') ?? '', 10);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return NextResponse.json({ ids: [], owner: null, covering: [] });
    }

    const { rows } = await risansiPool.query<{ id: string; kind: 'owner' | 'covering' | 'manager' | 'admin'; name: string }>(
      `WITH workers AS (
         SELECT c.primary_rep_id AS id, 'owner' AS kind FROM clients c WHERE c.id = $1 AND c.primary_rep_id IS NOT NULL
         UNION
         SELECT s.rep_id, 'covering' FROM client_secondary_reps s WHERE s.client_id = $1
       )
       SELECT u.id::text AS id, w.kind, u.name
         FROM (
           SELECT id, kind FROM workers
           UNION
           SELECT mr.manager_id, 'manager' FROM manager_reps mr WHERE mr.rep_id IN (SELECT id FROM workers)
           UNION
           SELECT a.id, 'admin' FROM users a WHERE a.role IN ('admin', 'sysadmin')
         ) w
         JOIN users u ON u.id = w.id AND u.is_active
        ORDER BY CASE w.kind WHEN 'owner' THEN 0 WHEN 'covering' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.name`,
      [clientId],
    );

    return NextResponse.json({
      ids: [...new Set(rows.map(r => r.id))],
      owner: rows.find(r => r.kind === 'owner')?.name ?? null,
      covering: rows.filter(r => r.kind === 'covering').map(r => r.name),
    });
  } catch (err) {
    console.error('visit-candidates API error:', err);
    return NextResponse.json({ ids: [], owner: null, covering: [] }, { status: 500 });
  }
}
