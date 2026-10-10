#!/usr/bin/env node
// Phase 8: does every statement the flag removal touched still parse and run?
//
//   node scripts/rep-ownership-sql-smoke.mjs
//
// Read-only. tsc checks the TypeScript around these queries and nothing at all
// inside them — a template literal with an unbalanced paren is a valid string
// and a broken statement, and the only place that shows up is at runtime, on a
// page a user opened. Each query below is the rewritten SQL copied verbatim from
// its module, run once against production with representative parameters.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const c = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT) || 5432,
  database: env.RISANSI_DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false } });
await c.connect();

let failed = 0;
async function run(label, sql, params = []) {
  try {
    const { rows } = await c.query(sql, params);
    const n = rows.length === 1 && rows[0] && Object.keys(rows[0]).length <= 5
      ? JSON.stringify(rows[0]) : `${rows.length} row(s)`;
    console.log(`  ok    ${label.padEnd(46)} ${n}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${label.padEnd(46)} ${e.message}`);
  }
}

// A manager with a team, and a client they reach through it.
const { rows: [who] } = await c.query(
  `SELECT mr.manager_id, mr.rep_id,
          (SELECT id FROM clients WHERE primary_rep_id = mr.rep_id AND deleted_at IS NULL LIMIT 1) AS client_id
     FROM manager_reps mr LIMIT 1`);
const UID = who.manager_id, CID = who.client_id;
console.log(`SQL SMOKE — manager #${UID}, client #${CID}\n`);

// ── lib/risansi-auth.ts · canViewClient ───────────────────────────
await run('auth · canViewClient', `SELECT (EXISTS (
   SELECT 1 FROM clients c
    WHERE c.id = $1
      AND (c.primary_rep_id = $2
           OR c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2))
 ) OR EXISTS (
   SELECT 1 FROM client_secondary_reps s
    WHERE s.client_id = $1
      AND (s.rep_id = $2
           OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2))
 )) AS ok`, [CID, UID]);

// ── lib/risansi-auth.ts · clientRuleSql, with the in-flight limb ──
await run('auth · clientScopeSql on opportunities', `SELECT count(*)::int AS n FROM opportunities o
   JOIN clients c ON c.id = o.client_id
  WHERE ((o.client_id IN (
      SELECT c2.id FROM clients c2
       WHERE c2.primary_rep_id = ${UID}
          OR c2.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${UID}))
    OR o.client_id IN (
      SELECT s.client_id FROM client_secondary_reps s
       WHERE s.rep_id = ${UID}
          OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${UID})))
    OR (o.rep_id = ${UID} AND o.stage NOT IN ('Won','Lost','Dropped')))`);

// ── lib/risansi-action-queue.ts · repVisibilitySql ────────────────
await run('action-queue · repVisibilitySql', `SELECT count(*)::int AS n FROM tasks t WHERE (
    t.assigned_to_rep = $1
    OR t.created_by = $2
    OR EXISTS (SELECT 1 FROM visits vs WHERE vs.id = t.visit_id AND vs.rep_id = $1)
    OR EXISTS (SELECT 1 FROM clients cl WHERE cl.id = t.client_id
                AND (cl.primary_rep_id = $1
                     OR cl.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $1)))
       OR EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = t.client_id
                   AND (s.rep_id = $1
                        OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $1)))
  )`, [UID, 'nobody@example.com']);

// ── lib/risansi-opp-filters.ts · both rewritten conditions ────────
await run('opp-filters · scoped rep + rep name', `SELECT count(*)::int AS n
   FROM opportunities o JOIN clients c ON c.id = o.client_id
  WHERE (c.primary_rep_id = $1
           OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = $1))
    AND EXISTS (SELECT 1 FROM users u2
                  WHERE u2.name = ANY($2::text[])
                    AND (c.primary_rep_id = u2.id
                         OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = u2.id)))`,
  [UID, ['Anil Vankudre', 'Prashant Dhere']]);

// ── lib/risansi-notify.ts · clientManagers ────────────────────────
await run('notify · clientManagers', `SELECT DISTINCT u.id, u.name, u.email
   FROM users u
  WHERE u.is_active = TRUE AND u.email IS NOT NULL AND u.email <> ''
    AND (
      u.id = (SELECT primary_rep_id FROM clients WHERE id = $1)
      OR u.id IN (SELECT rep_id FROM client_secondary_reps WHERE client_id = $1)
      OR u.id IN (
        SELECT mr.manager_id FROM manager_reps mr
         WHERE mr.rep_id = (SELECT primary_rep_id FROM clients WHERE id = $1)
            OR mr.rep_id IN (SELECT rep_id FROM client_secondary_reps WHERE client_id = $1))
    )`, [CID]);

// ── lib/risansi-notify.ts · weekly digest (the WITH whose parens moved) ──
await run('notify · weekly manager digest', `WITH mc AS (
   SELECT c.id, c.last_visit_date FROM clients c
    WHERE c.deleted_at IS NULL
      AND (c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $1)
           OR c.id IN (SELECT s.client_id FROM client_secondary_reps s
                        WHERE s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $1))
           OR c.primary_rep_id = $1))
 SELECT
   (SELECT count(*) FROM tasks t JOIN mc ON mc.id = t.client_id WHERE t.status <> 'completed')::int AS open_actions,
   (SELECT count(*) FROM tasks t JOIN mc ON mc.id = t.client_id WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE)::int AS overdue_actions,
   (SELECT count(*) FROM complaints co JOIN mc ON mc.id = co.client_id WHERE co.status NOT IN ('Resolved','Closed'))::int AS open_complaints,
   (SELECT count(*) FROM mc WHERE mc.last_visit_date IS NULL OR mc.last_visit_date < CURRENT_DATE - 90)::int AS visits_overdue`,
  [UID]);

// ── app/actions/risansi.ts · managers to tell about a planned visit ──
await run('risansi.ts · visit-planned recipients', `SELECT DISTINCT u.id, u.name, u.email FROM users u
  WHERE u.is_active AND u.id IN (
    SELECT mr.manager_id FROM manager_reps mr
     WHERE mr.rep_id = (SELECT primary_rep_id FROM clients WHERE id = $1)
        OR mr.rep_id IN (SELECT rep_id FROM client_secondary_reps WHERE client_id = $1))`, [CID]);

// ── lib/risansi-visit-filters.ts · the rewritten route scope ──────
const ownTours = `(SELECT c.tour_id FROM clients c
                    WHERE c.tour_id IS NOT NULL AND c.deleted_at IS NULL
                      AND (c.primary_rep_id = ${UID}
                           OR c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${UID})
                           OR c.id IN (SELECT s.client_id FROM client_secondary_reps s
                                        WHERE s.rep_id = ${UID}
                                           OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${UID}))))`;
await run('visit-filters · zones dropdown',
  `SELECT DISTINCT tr.zone AS v FROM tour_routes tr WHERE tr.zone IS NOT NULL AND tr.zone <> '' AND tr.id IN ${ownTours} ORDER BY 1`);
await run('visit-filters · routes dropdown',
  `SELECT tr.name AS v FROM tour_routes tr WHERE TRUE AND tr.id IN ${ownTours} ORDER BY tr.name`);
await run('visit-filters · reps dropdown',
  `SELECT DISTINCT u.name AS v FROM users u
    WHERE u.is_active = TRUE AND u.role IN ('rep','manager')
      AND (u.id = ${UID} OR u.id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${UID}))
    ORDER BY u.name`);
await run('visit-filters · getScopedRepNames', `SELECT DISTINCT u.name AS v
     FROM users u
     JOIN clients c ON (c.primary_rep_id = u.id
                        OR c.id IN (SELECT s.client_id FROM client_secondary_reps s WHERE s.rep_id = u.id))
     JOIN tour_routes tr ON tr.id = c.tour_id
    WHERE u.is_active = TRUE AND u.role IN ('rep','manager')
      AND c.deleted_at IS NULL AND tr.zone IS NOT NULL
    ORDER BY u.name`);
await run('visit-filters · rep name client filter', `SELECT count(*)::int AS n FROM clients c
   WHERE (c.primary_rep_id IN (SELECT id FROM users WHERE name IN ('Anil Vankudre'))
          OR c.id IN (SELECT s.client_id FROM client_secondary_reps s
                        JOIN users u ON u.id = s.rep_id WHERE u.name IN ('Anil Vankudre')))`);

// ── lib/risansi-client-rep.ts · the four helpers, composed ────────
await run('client-rep · all four helpers on one client', `SELECT
  (SELECT u.id FROM clients c9 JOIN users u ON u.id = c9.primary_rep_id AND u.is_active
    WHERE c9.id = c.id) AS owner_id,
  (SELECT string_agg(u.name, ', ' ORDER BY r.rank, u.name)
     FROM (SELECT c2.primary_rep_id AS user_id, 0 AS rank, NULL::timestamptz AS ord
             FROM clients c2 WHERE c2.id = c.id AND c2.primary_rep_id IS NOT NULL
            UNION ALL
           SELECT s.rep_id, 1, s.added_at FROM client_secondary_reps s WHERE s.client_id = c.id) r
     JOIN users u ON u.id = r.user_id) AS everyone,
  (SELECT string_agg(u.name, ', ' ORDER BY u.name) FROM client_secondary_reps s
     JOIN users u ON u.id = s.rep_id AND u.is_active WHERE s.client_id = c.id) AS covers,
  (SELECT string_agg(DISTINCT u.name, ', ') FROM manager_reps mr
     JOIN users u ON u.id = mr.manager_id AND u.is_active
    WHERE mr.rep_id IN (SELECT r.user_id FROM (
      SELECT c2.primary_rep_id AS user_id FROM clients c2 WHERE c2.id = c.id AND c2.primary_rep_id IS NOT NULL
       UNION ALL SELECT s.rep_id FROM client_secondary_reps s WHERE s.client_id = c.id) r)) AS managers
 FROM clients c WHERE c.id = $1`, [CID]);

// ── lib/risansi-client-rep.ts · resolveClientPrimaryRep ───────────
await run('client-rep · resolveClientPrimaryRep',
  `SELECT (SELECT u.id FROM users u WHERE u.id = c.primary_rep_id AND u.is_active) AS primary_rep,
          (SELECT s.rep_id FROM client_secondary_reps s
             JOIN users su ON su.id = s.rep_id AND su.is_active
            WHERE s.client_id = c.id AND s.rep_id = $2 LIMIT 1) AS covering
     FROM clients c WHERE c.id = $1`, [CID, UID]);

// ── lib/risansi-auth.ts · complaintVisibilitySql ──────────────────
await run('auth · complaintVisibilitySql', `SELECT count(*)::int AS n FROM complaints cm WHERE (
    cm.assigned_to_user = ${UID}
    OR lower(cm.created_by) = 'nobody@example.com'
    OR (cm.client_id IN (
      SELECT c2.id FROM clients c2
       WHERE c2.primary_rep_id = ${UID}
          OR c2.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${UID}))
    OR cm.client_id IN (
      SELECT s.client_id FROM client_secondary_reps s
       WHERE s.rep_id = ${UID}
          OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${UID})))
  )`);

// ── lib/risansi-auth.ts · getManagerAssignableReps ────────────────
await run('auth · getManagerAssignableReps',
  `SELECT rep_id FROM manager_reps WHERE manager_id = $1`, [UID]);

// ── app/risansi/pipeline/page.tsx · board scope + rep filter ──────
await run('pipeline · my-pipeline scope', `SELECT count(*)::int AS n
   FROM opportunities o JOIN clients c ON c.id = o.client_id
  WHERE (c.primary_rep_id = $1
         OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = $1))`, [UID]);

await run('pipeline · rep filter', `SELECT count(*)::int AS n
   FROM opportunities o JOIN clients c ON c.id = o.client_id
  WHERE EXISTS (SELECT 1 FROM users u2
                  WHERE u2.name = ANY($1::text[])
                    AND (c.primary_rep_id = u2.id
                         OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = u2.id)))`,
  [['Prashant Dhere']]);

// ── app/risansi/pipeline/page.tsx · CAN_EDIT_CASE ─────────────────
await run('pipeline · can_edit case', `SELECT count(*) FILTER (WHERE ce)::int AS editable FROM (
  SELECT CASE
    WHEN $1 IN ('admin','sysadmin') THEN TRUE
    WHEN o.rep_id = $2 THEN TRUE
    WHEN c.primary_rep_id = $2 THEN TRUE
    WHEN c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2) THEN TRUE
    WHEN EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = c.id
                  AND (s.rep_id = $2
                       OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2))) THEN TRUE
    ELSE FALSE
  END AS ce
  FROM opportunities o JOIN clients c ON c.id = o.client_id LIMIT 500) x`, ['manager', UID]);

// ── app/risansi/pipeline/page.tsx · the Won tile and analytics ────
await run('pipeline · won tile scope', `SELECT count(*)::int AS n FROM opportunities o
  WHERE o.stage = 'Won'
    AND ((o.client_id IN (SELECT c2.id FROM clients c2
           WHERE c2.primary_rep_id = $1
              OR c2.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = $1))))`, [UID]);

await run('pipeline · analytics rep filter', `SELECT count(*)::int AS n FROM opportunities a
  WHERE a.client_id IN (SELECT c2.id FROM clients c2 JOIN users u2 ON u2.name = ANY($1::text[])
    AND (c2.primary_rep_id = u2.id OR c2.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = u2.id)))`,
  [['Prashant Dhere']]);

// ── app/risansi/pipeline/page.tsx · tour_people (owner + cover) ───
await run('pipeline · owner + cover name list', `SELECT
  (SELECT string_agg(u2.name || CASE WHEN r2.rank = 1 THEN ' (cover)' ELSE '' END, ', ' ORDER BY r2.rank, u2.name)
     FROM (SELECT c2.primary_rep_id AS user_id, 0 AS rank FROM clients c2
            WHERE c2.id = c.id AND c2.primary_rep_id IS NOT NULL
           UNION ALL
           SELECT s.rep_id, 1 FROM client_secondary_reps s WHERE s.client_id = c.id) r2
     JOIN users u2 ON u2.id = r2.user_id) AS tour_people
  FROM clients c WHERE c.id = $1`, [CID]);

// ── app/risansi/pipeline/page.tsx · the rep filter's option list ──
await run('pipeline · rep filter options', `SELECT DISTINCT u.name FROM users u
  WHERE u.is_active = TRUE
    AND (EXISTS (SELECT 1 FROM clients c WHERE c.primary_rep_id = u.id AND c.deleted_at IS NULL)
         OR EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.rep_id = u.id))
  ORDER BY u.name`);

// ── app/risansi/field/page.tsx · the two rep_name lists ───────────
await run('field · rep_name list', `SELECT COALESCE(
  (SELECT string_agg(u.name, ', ' ORDER BY r.rank, u.name)
     FROM (SELECT c2.primary_rep_id AS user_id, 0 AS rank FROM clients c2
            WHERE c2.id = c.id AND c2.primary_rep_id IS NOT NULL
           UNION ALL
           SELECT s.rep_id, 1 FROM client_secondary_reps s WHERE s.client_id = c.id) r
     JOIN users u ON u.id = r.user_id), '-') AS rep_name
  FROM clients c WHERE c.id = $1`, [CID]);

// ── lib/risansi-visit-filters.ts · exhibition calendar scope ──────
await run('visit-filters · exhibition scope', `SELECT u.id::text AS id FROM users u
  WHERE u.is_active = TRUE
    AND (u.id = ${UID} OR u.id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${UID}))
    AND EXISTS (SELECT 1 FROM clients c
                  JOIN tour_routes tr ON tr.id = c.tour_id
                 WHERE c.deleted_at IS NULL
                   AND (c.primary_rep_id = u.id
                        OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = u.id))
                   AND tr.zone IS NOT NULL)`);

// ── app/admin/page.tsx · the team + client counts ─────────────────
await run('admin · user list counts', `SELECT u.id::int,
    (SELECT COUNT(*)::int FROM manager_reps mr WHERE mr.manager_id = u.id) AS team_count,
    COUNT(DISTINCT c.id)::int AS clients_count
  FROM users u
  LEFT JOIN clients c ON c.deleted_at IS NULL
                     AND (c.primary_rep_id = u.id
                          OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = u.id))
  GROUP BY u.id`);

// ── app/actions/risansi-reps.ts · createRep's manager link ────────
await run('reps · createRep manager link (rolled back)', `SELECT 1 AS ok
  WHERE EXISTS (SELECT 1 FROM manager_reps WHERE manager_id = $1)`, [UID]);

console.log(`\n  ${failed === 0 ? 'all statements parse and run.' : `${failed} STATEMENT(S) BROKEN.`}\n`);
await c.end();
process.exit(failed === 0 ? 0 : 1);
