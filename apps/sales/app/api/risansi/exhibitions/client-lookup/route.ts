import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';

/**
 * The Exhibition module's ONLY connection to existing portal data.
 *
 * Given a company name typed at a stand, answer one question: do we already know
 * this company? A hit lets the UI flag the meeting as an existing client and keep
 * the id; a miss is not an error — the meeting is captured exactly the same way,
 * just without a link. This route never creates or modifies anything.
 *
 * Deliberately NOT visibility-filtered. Every other client search in the portal
 * applies clientVisibilitySql, which restricts a rep to their own tours — correct
 * there, wrong here: at an exhibition a rep meets companies from every territory,
 * and a scoped search would report "not a client" for a company another rep owns,
 * which is exactly the false negative this flag exists to prevent.
 *
 * The trade-off is contained by returning only what the flag needs — id, code,
 * name, city, industry, status. No revenue, no contacts, no owner, no notes. The
 * caller learns "this exists", not anything about the relationship.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();
  if (q.length < 2) return Response.json({ matches: [] });

  // Escape LIKE metacharacters so a name containing % or _ cannot turn into a
  // wildcard that matches the entire client base.
  const esc = q.replace(/[\\%_]/g, c => `\\${c}`);

  try {
    const { rows } = await risansiPool.query(
      `SELECT c.id, c.code, c.legal_name, c.city, c.state, c.industry, c.status
         FROM clients c
        WHERE c.deleted_at IS NULL
          AND (c.legal_name ILIKE $1 ESCAPE '\\' OR c.code ILIKE $1 ESCAPE '\\')
        -- Exact name first, then prefix, then anywhere: the company someone typed
        -- in full should never be pushed off the list by an incidental substring.
        ORDER BY (CASE WHEN LOWER(c.legal_name) = LOWER($3) THEN 0
                       WHEN c.legal_name ILIKE $2 ESCAPE '\\' THEN 1
                       ELSE 2 END),
                 c.legal_name ASC
        LIMIT 10`,
      [`%${esc}%`, `${esc}%`, q],
    );

    const matches = rows.map(r => ({
      id: r.id,
      code: r.code,
      legal_name: r.legal_name,
      city: r.city,
      state: r.state,
      industry: r.industry,
      status: r.status,
      // An exact (case-insensitive) name match is what the UI auto-flags on; a
      // partial hit is offered as a suggestion for the user to confirm.
      exact: String(r.legal_name ?? '').trim().toLowerCase() === q.toLowerCase(),
    }));

    return Response.json({ matches });
  } catch (err) {
    // Never swallow into an empty result: "no matches" and "the lookup broke" must
    // not look identical, or a rep silently re-registers a known client.
    console.error('[exhibitions/client-lookup]', err);
    return Response.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
