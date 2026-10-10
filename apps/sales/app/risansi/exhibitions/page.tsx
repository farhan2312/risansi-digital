import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { exhibitionVisibilitySql } from '@/lib/risansi-exhibition-fields';
import { ExhibitionsClient, type ExhibitionRow, type UserOpt } from '@/components/risansi/ExhibitionsClient';

export const dynamic = 'force-dynamic';

// Log before falling back: a swallowed query error and a genuinely empty module
// look identical on screen otherwise.
async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[exhibitions]', err); return fallback; }
}

export default async function ExhibitionsPage() {
  const me = await getCurrentUser();

  // An exhibition has no client and therefore no tour, so the portal's usual
  // clientScopeSql does not apply. It is scoped by involvement instead: the
  // team, whoever proposed it, and the named approver — plus admins, who see
  // everything. The approver is in that list because they are usually not on
  // the team, and without them approvals would stall on an invisible record.
  const visPred = exhibitionVisibilitySql(me.role, me.id, 'e');
  const visClause = visPred ? `WHERE ${visPred}` : '';

  const [rows, users] = await Promise.all([
    q<ExhibitionRow[]>(async () => {
      const { rows } = await risansiPool.query<ExhibitionRow>(`
        SELECT e.id, e.name, e.organizer, e.venue, e.city, e.state, e.country,
               e.industry, e.source, e.website,
               e.start_date::text AS start_date, e.end_date::text AS end_date,
               e.status, e.participation, e.suggested,
               e.estimated_cost_inr::float8 AS estimated_cost_inr,
               e.recommendation, e.approver_id, ap.name AS approver_name,
               e.submitted_at::text AS submitted_at,
               e.decided_at::text AS decided_at, e.decision_notes,
               e.created_by, e.created_by_name,
               (SELECT COUNT(*)::int FROM exhibition_team t WHERE t.exhibition_id = e.id) AS team_count,
               (SELECT u.name FROM exhibition_team t JOIN users u ON u.id = t.user_id
                 WHERE t.exhibition_id = e.id AND t.team_role = 'Team Lead' LIMIT 1) AS team_lead,
               (SELECT COUNT(*)::int FROM exhibition_meetings m WHERE m.exhibition_id = e.id) AS meeting_count,
               -- The lookup payoff: how many companies met were already clients.
               (SELECT COUNT(*)::int FROM exhibition_meetings m
                 WHERE m.exhibition_id = e.id AND m.client_id IS NOT NULL) AS existing_client_count,
               (SELECT COALESCE(SUM(x.actual_inr),0)::float8 FROM exhibition_expenses x
                 WHERE x.exhibition_id = e.id) AS actual_cost_inr
          FROM exhibitions e
          LEFT JOIN users ap ON ap.id = e.approver_id
         ${visClause}
         ORDER BY COALESCE(e.start_date, e.created_at::date) DESC, e.id DESC
      `);
      return rows;
    }, []),

    // Team picker + approver picker source. Company-wide, because an exhibition
    // team is drawn from the whole organisation, not one tour.
    q<UserOpt[]>(async () => {
      const { rows } = await risansiPool.query<UserOpt>(
        `SELECT id, name, role FROM users
          WHERE is_active = TRUE AND status = 'Approved'
          ORDER BY name`,
      );
      return rows;
    }, []),
  ]);

  return (
    <>
      <Topbar crumbs={['Exhibitions']} />
      <ExhibitionsClient rows={rows} users={users} me={{ id: me.id, role: me.role }} />
    </>
  );
}
