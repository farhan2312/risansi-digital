/**
 * Phase 4 — point each Testing / Pump Selection account at its identity, and
 * prove that nothing else has to move.
 *
 * Dry by default. Pass --apply to write.
 *
 * Two jobs, and the second is the one worth reading.
 *
 * ── 1. Fill `identity_user_id` ───────────────────────────────────
 *
 * Matched on lower(email), the only key the two sides share. Requires
 * migrations/testing-select/0001_identity_user_id.sql to have been applied;
 * the script says so and stops rather than half-working if it has not.
 *
 * Accounts with no identity row are left null on purpose. Those are the
 * shared mailboxes and test logins that were deliberately not carried (see
 * seed-identity-from-testing-select.mjs), and a null here is the record of
 * that decision — after cutover they cannot sign in, which is the intent.
 *
 * ── 2. Audit what references a user id, and where it points ──────
 *
 * The plan said to remap everything onto identity uuids. Do not. There are
 * four declared foreign keys onto these two tables and eighteen further uuid
 * columns referencing a user with no constraint at all, so nothing in the
 * database would stop a remap from silently orphaning rows — and because the
 * two tables use different uuids for the same person, some of those columns
 * point at `users` and some at `users_pump` with no way to tell from the
 * schema which.
 *
 * So this resolves every one of them against both tables and reports the
 * split. That turns "which table does this column mean" from a guess into a
 * measurement, and surfaces any rows that already point at nothing. Run it
 * before the cutover and again after: the numbers should not move, because
 * no id is changing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, '..', 'apps', 'sales', 'package.json'));
const pg = require('pg');

const APPLY = process.argv.includes('--apply');

const readEnv = (p) => Object.fromEntries(
  fs.readFileSync(p, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const sales = readEnv(path.join(HERE, '..', 'apps', 'sales', '.env.local'));
const hub   = readEnv(path.join(HERE, '..', 'apps', 'hub', '.env.local'));

const src = new pg.Client({
  host: sales.DB_HOST, port: Number(sales.DB_PORT) || 5432,
  database: 'Pump_Selector_and_testing', user: sales.DB_USER, password: sales.DB_PASSWORD,
  ssl: { rejectUnauthorized: true },
});
const id = new pg.Client({
  host: hub.IDENTITY_DB_HOST, port: Number(hub.IDENTITY_DB_PORT) || 5432,
  database: hub.IDENTITY_DB_NAME, user: hub.IDENTITY_DB_USER,
  password: hub.IDENTITY_DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
await src.connect();
await id.connect();

// ── Is the migration in? ──────────────────────────────────────────
const haveCols = (await src.query(
  `SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'identity_user_id'
      AND table_name IN ('users', 'users_pump')`)).rows.map(r => r.table_name);

const ready = haveCols.includes('users') && haveCols.includes('users_pump');
if (!ready) {
  console.log('identity_user_id is missing from: '
    + ['users', 'users_pump'].filter(t => !haveCols.includes(t)).join(', '));
  console.log('Apply migrations/testing-select/0001_identity_user_id.sql first.');
  console.log('Continuing with the reference audit only — it needs no new columns.\n');
}

const identities = new Map((await id.query(
  `SELECT lower(email) email, id::text id FROM identity.users WHERE is_active`)).rows
  .map(r => [r.email, r.id]));
await id.end();

// ── 1. The link ───────────────────────────────────────────────────
if (ready) {
  for (const table of ['users', 'users_pump']) {
    const rows = (await src.query(
      `SELECT id::text id, lower(trim(email)) email, name, identity_user_id::text linked
         FROM public.${table} ORDER BY email`)).rows;

    const toLink = rows.filter(r => identities.has(r.email) && !r.linked);
    const unmatched = rows.filter(r => !identities.has(r.email));
    const already = rows.filter(r => r.linked).length;

    console.log(`\n── ${table}: ${rows.length} rows, ${already} already linked ──`);
    console.log(`to link: ${toLink.length}   no identity (deliberate): ${unmatched.length}`);
    if (unmatched.length) console.table(unmatched.map(r => ({ email: r.email, name: r.name })));

    if (APPLY && toLink.length) {
      await src.query('BEGIN');
      try {
        for (const r of toLink) {
          await src.query(
            `UPDATE public.${table} SET identity_user_id = $2
              WHERE id = $1 AND identity_user_id IS NULL`,
            [r.id, identities.get(r.email)]);
        }
        await src.query('COMMIT');
        console.log(`linked ${toLink.length}`);
      } catch (e) { await src.query('ROLLBACK'); console.error('ROLLED BACK:', e.message); throw e; }
    }
  }
}

// ── 2. Where every user reference actually points ─────────────────
const refs = (await src.query(`
  SELECT co.table_name, co.column_name
    FROM information_schema.columns co
   WHERE co.table_schema = 'public' AND co.data_type = 'uuid'
     AND co.column_name IN ('user_id','created_by','updated_by','reported_by','uploaded_by',
                            'assigned_by','decided_by','sent_by','reviewed_by')
     AND co.table_name NOT IN ('users','users_pump')
   ORDER BY 1, 2`)).rows;

// users.reviewed_by and users_pump.reviewed_by are self-references; included
// separately so the report is complete rather than tidy.
refs.push({ table_name: 'users', column_name: 'reviewed_by' });
refs.push({ table_name: 'users_pump', column_name: 'reviewed_by' });

// A uuid that exists in BOTH tables cannot be resolved by value alone, and
// there is one: it belongs to a different person on each side. Find it first,
// because otherwise every column that happens to carry it reads as ambiguous
// and the genuinely unambiguous ones are lost in the noise.
const collisions = (await src.query(`
  SELECT u.id::text uuid, lower(u.email) in_users, lower(p.email) in_users_pump
    FROM public.users u JOIN public.users_pump p ON p.id = u.id ORDER BY 2`)).rows;

if (collisions.length) {
  console.log('\n── !! the same uuid in both tables, meaning different people ──');
  console.table(collisions);
  console.log('Any id resolved without knowing which table it came from conflates these.');
  console.log('This predates the migration. `identity_user_id` is what disambiguates');
  console.log('them from here on, which is another reason not to remap onto one key.');
}
const collided = new Set(collisions.map(c => c.uuid));

const audit = [];
for (const { table_name, column_name } of refs) {
  try {
    const r = (await src.query(`
      SELECT count(*) FILTER (WHERE t."${column_name}" IS NOT NULL)::int AS set_rows,
             count(DISTINCT t."${column_name}")::int                      AS distinct_ids,
             count(*) FILTER (WHERE u.id  IS NOT NULL)::int               AS in_users,
             count(*) FILTER (WHERE up.id IS NOT NULL)::int               AS in_pump,
             count(*) FILTER (WHERE t."${column_name}" IS NOT NULL
                               AND NOT (t."${column_name}" = ANY($1::uuid[]))
                               AND u.id IS NULL AND up.id IS NULL)::int   AS orphan,
             count(*) FILTER (WHERE t."${column_name}" = ANY($1::uuid[]))::int AS ambiguous
        FROM public."${table_name}" t
        LEFT JOIN public.users      u  ON u.id  = t."${column_name}"
                                      AND NOT (t."${column_name}" = ANY($1::uuid[]))
        LEFT JOIN public.users_pump up ON up.id = t."${column_name}"
                                      AND NOT (t."${column_name}" = ANY($1::uuid[]))`,
      [[...collided]])).rows[0];
    if (r.set_rows > 0) {
      audit.push({
        table: table_name, column: column_name, rows: r.set_rows, ids: r.distinct_ids,
        users: r.in_users, users_pump: r.in_pump,
        orphan: r.orphan, ambiguous: r.ambiguous,
        // Decided on the unambiguous rows only; the colliding uuid is counted
        // separately rather than allowed to make every column look uncertain.
        points_at: r.in_users && r.in_pump ? 'BOTH — check'
          : r.in_users ? 'users' : r.in_pump ? 'users_pump'
          : r.ambiguous ? 'only the shared uuid' : 'nothing',
      });
    }
  } catch { /* column not comparable */ }
}

console.log('\n── every user reference, and which table it resolves against ──');
console.table(audit);

const orphans = audit.filter(a => a.orphan > 0);
if (orphans.length) {
  console.log('\nRows pointing at a user that no longer exists. These predate this work —');
  console.log('no id is being changed — but they are worth knowing about:');
  console.table(orphans.map(({ table, column, orphan }) => ({ table, column, orphan })));
}

console.log(`\n${APPLY ? 'applied' : 'DRY RUN — nothing written'}`);
await src.end();
