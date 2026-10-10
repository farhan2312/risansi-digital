import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientVisibilitySql } from '@/lib/risansi-auth';
import { clientPrimaryRepSql } from '@/lib/risansi-client-rep';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  if (q.length < 2) return Response.json([]);

  const user = await getCurrentUser();
  if (!user.email) return Response.json([], { status: 401 });

  try {
    // Per-user visibility — predicate inlines integers, so it needs no params.
    const visPred = clientVisibilitySql(user, 'c');
    const visClause = visPred ? `AND (${visPred})` : '';

    const res = await risansiPool.query(
      `SELECT c.id, c.code, c.legal_name, c.city, c.state, c.industry,
              -- The ONE resolved owner: the client's own primary rep, if they
              -- are still active.
              (SELECT u.name FROM users u WHERE u.id = ${clientPrimaryRepSql('c.id')}) AS owner_name
       FROM clients c
       WHERE c.deleted_at IS NULL
         -- Match the Client 360 list, which shows every non-deleted client of
         -- any status. The old status=ACTIVE filter hid 1,500+ clients, every
         -- lead and prospect among them, so a rep could not plan a visit or
         -- raise an opportunity against them. Status is a list filter, not a
         -- gate on who exists.
         AND (
           c.legal_name ILIKE $1
           OR c.code     ILIKE $1
           OR c.city     ILIKE $1
         )
         ${visClause}
       -- Prefix hits first (typing a name prefix surfaces that client over a
       -- mid-word match), so the LIMIT never buries the client searched for.
       ORDER BY (CASE WHEN c.legal_name ILIKE $2 OR c.code ILIKE $2 THEN 0 ELSE 1 END),
                c.legal_name ASC
       LIMIT 25`,
      [`%${q}%`, `${q}%`],
    );
    return Response.json(res.rows);
  } catch {
    return Response.json([]);
  }
}
