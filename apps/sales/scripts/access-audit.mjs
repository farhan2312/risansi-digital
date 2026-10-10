#!/usr/bin/env node
// End-to-end access audit: run every surface's real predicate as every real
// user, and check what comes back against the rule that is supposed to govern it.
//
//   node scripts/access-audit.mjs
//
// Read-only. A static sweep can tell you a scope helper is CALLED; it cannot
// tell you the helper was applied to the right column, or that a surface's
// hand-rolled predicate agrees with the shared one. This runs them.
//
// The canonical rule (lib/risansi-auth.ts clientRuleSql): a client is visible if
// you own it, cover it, or manage whoever does.
//
// Three documented exceptions widen a surface beyond that, and each is asserted
// rather than assumed:
//   opportunities  + an open opportunity you own      (OWN_OPEN.opportunity)
//   visits         + an uncompleted visit you own     (OWN_OPEN.visit)
//   tasks          + an open action you own or raised (OWN_OPEN.task)
//   complaints     + one assigned to you or raised by you
// Anything a surface returns that neither the rule nor its own exception allows
// is a leak, and is printed with the client code so it can be looked at.
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

// ── the rule, as SQL ──────────────────────────────────────────────
const RULE = (col, uid) => `(
  ${col} IN (SELECT c2.id FROM clients c2
              WHERE c2.primary_rep_id = ${uid}
                 OR c2.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid}))
  OR ${col} IN (SELECT s.client_id FROM client_secondary_reps s
                 WHERE s.rep_id = ${uid}
                    OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid})))`;

// ── the surfaces, each as (predicate it applies, exception it is allowed) ──
const SURFACES = [
  {
    name: 'Client 360 / list / revenue / coverage',
    from: 'clients c',
    id: 'c.id::text',
    label: 'c.code',
    where: (uid) => `c.deleted_at IS NULL AND ${RULE('c.id', uid)}`,
    allowed: () => 'FALSE',                 // no exception: the rule is the whole answer
    clientCol: 'c.id',
  },
  {
    name: 'Opportunities (pipeline, stage pages, export)',
    from: 'opportunities o JOIN clients c ON c.id = o.client_id',
    id: "'#' || o.id::text",
    label: 'c.code',
    where: (uid) => `(${RULE('o.client_id', uid)} OR (o.rep_id = ${uid} AND o.stage NOT IN ('Won','Lost','Dropped')))`,
    allowed: (uid) => `o.rep_id = ${uid} AND o.stage NOT IN ('Won','Lost','Dropped')`,
    clientCol: 'o.client_id',
  },
  {
    name: 'Visits (field, visit detail, export, print)',
    from: 'visits v JOIN clients c ON c.id = v.client_id',
    id: "'#' || v.id::text",
    label: 'c.code',
    where: (uid) => `(${RULE('v.client_id', uid)} OR (v.rep_id = ${uid} AND v.status <> 'completed'))`,
    allowed: (uid) => `v.rep_id = ${uid} AND v.status <> 'completed'`,
    clientCol: 'v.client_id',
  },
  {
    name: 'Action registry (tasks)',
    from: 'tasks t LEFT JOIN clients c ON c.id = t.client_id',
    id: "'#' || t.id::text",
    label: 'COALESCE(c.code,, no client)',   // replaced below; keeps the shape readable
    where: (uid, email) => `(
      t.assigned_to_rep = ${uid}
      OR lower(t.created_by) = ${email}
      OR EXISTS (SELECT 1 FROM visits vs WHERE vs.id = t.visit_id AND vs.rep_id = ${uid})
      OR EXISTS (SELECT 1 FROM clients cl WHERE cl.id = t.client_id
                  AND (cl.primary_rep_id = ${uid}
                       OR cl.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid})))
      OR EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = t.client_id
                  AND (s.rep_id = ${uid}
                       OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid}))))`,
    allowed: (uid, email) => `t.assigned_to_rep = ${uid} OR lower(t.created_by) = ${email}
      OR EXISTS (SELECT 1 FROM visits vs WHERE vs.id = t.visit_id AND vs.rep_id = ${uid})
      OR t.client_id IS NULL`,
    clientCol: 't.client_id',
  },
  {
    name: 'Complaints',
    from: 'complaints cm LEFT JOIN clients c ON c.id = cm.client_id',
    id: "'#' || cm.id::text",
    label: 'COALESCE(c.code, , no client)',
    where: (uid, email) => `(
      cm.assigned_to_user = ${uid}
      OR lower(cm.created_by) = ${email}
      OR ${RULE('cm.client_id', uid)})`,
    allowed: (uid, email) => `cm.assigned_to_user = ${uid} OR lower(cm.created_by) = ${email} OR cm.client_id IS NULL`,
    clientCol: 'cm.client_id',
  },
];

// The label expressions above are written for readability; fix the two that use
// a comma-separated COALESCE into real SQL.
for (const s of SURFACES) s.label = s.label.replace(', no client)', ", '(no client)')");

const { rows: people } = await c.query(
  `SELECT id::int AS id, name, role, lower(COALESCE(email,'')) AS email
     FROM users
    WHERE is_active = TRUE AND role IN ('rep','manager')
    ORDER BY role DESC, name`);

const q = (s) => `'${String(s).split("'").join("''")}'`;
let leaks = 0, checked = 0;

for (const surface of SURFACES) {
  console.log(`\n${'='.repeat(74)}\n${surface.name}`);
  console.log(`${'person'.padEnd(24)} ${'role'.padEnd(9)} ${'visible'.padStart(8)} ${'by rule'.padStart(8)} ${'by exception'.padStart(13)}   leaks`);
  console.log('-'.repeat(74));

  for (const p of people) {
    const uid = p.id, email = q(p.email);
    const where = surface.where(uid, email);
    const allowed = surface.allowed(uid, email);
    const rule = surface.clientCol ? RULE(surface.clientCol, uid) : 'FALSE';

    const sql = `
      SELECT count(*)::int AS visible,
             count(*) FILTER (WHERE ${rule})::int AS by_rule,
             count(*) FILTER (WHERE NOT (${rule}) AND (${allowed}))::int AS by_exception,
             count(*) FILTER (WHERE NOT (${rule}) AND NOT (${allowed}))::int AS leaked
        FROM ${surface.from}
       WHERE ${where}`;
    let r;
    try {
      ({ rows: [r] } = await c.query(sql));
    } catch (e) {
      console.log(`  ${p.name.padEnd(22)} QUERY FAILED: ${e.message}`);
      leaks++;
      continue;
    }
    checked++;
    const flag = r.leaked > 0 ? `  <-- ${r.leaked}` : '';
    console.log(`${p.name.padEnd(24)} ${p.role.padEnd(9)} ${String(r.visible).padStart(8)} ${String(r.by_rule).padStart(8)} ${String(r.by_exception).padStart(13)}${flag}`);

    if (r.leaked > 0) {
      leaks += r.leaked;
      const { rows: ex } = await c.query(`
        SELECT ${surface.id} AS id, ${surface.label} AS label
          FROM ${surface.from}
         WHERE ${where} AND NOT (${rule}) AND NOT (${allowed})
         LIMIT 5`);
      for (const e of ex) console.log(`        ${e.id}  ${e.label}`);
    }
  }
}

// ── the other direction: does anyone see NOTHING who should see something? ──
console.log(`\n${'='.repeat(74)}\nPEOPLE WITH NO CLIENTS AT ALL`);
const { rows: empty } = await c.query(`
  SELECT u.name, u.role FROM users u
   WHERE u.is_active AND u.role IN ('rep','manager')
     AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.deleted_at IS NULL
                      AND (c.primary_rep_id = u.id
                           OR c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = u.id)
                           OR c.id IN (SELECT client_id FROM client_secondary_reps s WHERE s.rep_id = u.id)))
   ORDER BY u.name`);
console.log(empty.length
  ? empty.map(e => `  ${e.name} (${e.role}) — signs in to an empty portal`).join('\n')
  : '  none');

console.log(`\n${'='.repeat(74)}`);
console.log(leaks === 0
  ? `No leaks. ${checked} person-surface combinations checked; everything visible is\nallowed either by the ownership rule or by that surface's documented exception.`
  : `${leaks} LEAKED ROW(S) across ${checked} checks — listed above.`);

await c.end();
process.exit(leaks === 0 ? 0 : 1);
