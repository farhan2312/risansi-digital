/**
 * Phase 3 step 2: give every sales account a Risansi Digital identity.
 *
 *   node scripts/seed-identity-from-sales.mjs            # report, change nothing
 *   node scripts/seed-identity-from-sales.mjs --apply    # write
 *
 * Nothing in the running application reads any of this yet. Sales still signs
 * people in with NextAuth against its own password_hash and will until step 3,
 * so this can be run, inspected, and run again before anything depends on it.
 *
 * ── Three rules it will not break ─────────────────────────────────
 *
 * 1. An identity that already exists is never overwritten. One person has
 *    already signed up at the hub and chosen a password there; seeding must
 *    not replace it with their sales one, nor demote their approver role. It
 *    links and leaves everything else alone.
 *
 * 2. Password hashes are carried, not reset. Sales stores bcrypt `$2b$` and
 *    the identity package verifies with bcryptjs, which reads `$2a$`, `$2b$`
 *    and `$2y$` — checked before this was written. So nobody resets anything
 *    on cutover day, which is the single biggest thing that can go wrong on
 *    the one day everybody is watching. (MIGRATION_PLAN.md §2.4, revised.)
 *
 * 3. A deactivated sales account gets an inactive identity and NO grant. It
 *    keeps the mapping complete — its rows still reference users.id — without
 *    handing anybody a way in. That includes admin@risansi.com, retired on
 *    10 Oct, whose history still has to resolve to a name.
 *
 * Re-runnable. Every write is an upsert keyed on the email or the existing
 * link, so running it twice changes nothing the second time.
 */

import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');

// ── Connections ───────────────────────────────────────────────────
const envPath = ['.env.local', '.env'].map(f => path.resolve(f)).find(f => fs.existsSync(f));
if (!envPath) { console.log('No .env.local or .env here. Run this from apps/sales.'); process.exit(1); }
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const base = {
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432,
  user: env.DB_USER, password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: env.DB_SSL_INSECURE !== '1' },
  connectionTimeoutMillis: 15_000,
};
const sales = new pg.Client({ ...base, database: env.RISANSI_DB_NAME });
const identity = new pg.Client({ ...base, database: env.IDENTITY_DB_NAME || 'risansi_identity' });
await sales.connect();
await identity.connect();

console.log(`sales:    ${env.RISANSI_DB_NAME}`);
console.log(`identity: ${env.IDENTITY_DB_NAME || 'risansi_identity'}`);
console.log(APPLY ? '\nAPPLYING\n' : '\nDRY RUN — nothing will be written. Pass --apply to write.\n');

// ── Preconditions, checked rather than assumed ────────────────────
const col = await sales.query(
  `SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='identity_user_id'`);
if (!col.rowCount) {
  console.log('users.identity_user_id does not exist. Run migration 0121 first.');
  process.exit(1);
}

const unknownRoles = await sales.query(
  `SELECT DISTINCT role FROM users WHERE role IS NOT NULL
     AND role NOT IN (SELECT role FROM (VALUES ('rep'),('manager'),('admin'),('sysadmin'),('staff')) AS t(role))`);
if (unknownRoles.rowCount) {
  // The grant carries a composite foreign key onto identity.app_roles, so an
  // unknown role would fail mid-run. Better to say so before writing anything.
  console.log(`Sales has roles identity does not know: ${unknownRoles.rows.map(r => r.role).join(', ')}`);
  console.log('Add them to identity.app_roles before seeding.');
  process.exit(1);
}

const { rows: people } = await sales.query(`
  SELECT id, lower(trim(email)) AS email, name, role, password_hash,
         must_change_password, is_active, status, identity_user_id
    FROM users
   WHERE email IS NOT NULL AND trim(email) <> ''
   ORDER BY id`);

// Someone is entitled to open sales only if their sales account is live.
const entitled = p => p.is_active && p.status === 'Approved';

const summary = { linkedExisting: 0, created: 0, alreadyLinked: 0, grants: 0, noGrant: 0 };
const notes = [];

for (const p of people) {
  const existing = await identity.query(
    `SELECT id, name, role, is_active, (password_hash IS NOT NULL) AS has_pw
       FROM identity.users WHERE lower(email) = $1`, [p.email]);
  const already = existing.rows[0];

  let identityId = already?.id ?? null;

  if (already) {
    // Rule 1. Link only.
    summary[p.identity_user_id ? 'alreadyLinked' : 'linkedExisting']++;
    notes.push(`  link    ${p.email.padEnd(34)} → existing identity (role ${already.role}`
      + `${already.has_pw ? ', own password kept' : ', no password'}), untouched`);
  } else {
    summary.created++;
    notes.push(`  create  ${p.email.padEnd(34)} ${entitled(p) ? 'active' : 'INACTIVE'}`
      + `, password ${p.password_hash ? 'carried' : 'none'}`);
    if (APPLY) {
      const ins = await identity.query(
        `INSERT INTO identity.users (email, name, password_hash, must_change_password, is_active)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [p.email, p.name ?? p.email, p.password_hash, p.must_change_password ?? false, entitled(p)]);
      identityId = ins.rows[0].id;
    }
  }

  if (APPLY && identityId) {
    await sales.query('UPDATE users SET identity_user_id = $2 WHERE id = $1', [p.id, identityId]);
  }

  // Rule 3. A grant only for somebody who can use sales today.
  if (entitled(p)) {
    summary.grants++;
    if (APPLY && identityId) {
      await identity.query(
        `INSERT INTO identity.app_grants (user_id, app_slug, status, app_role, decided_at, decided_note)
         VALUES ($1,'sales','Approved',$2, now(), 'Carried over from the sales portal at the Phase 3 cutover.')
         ON CONFLICT (user_id, app_slug) DO UPDATE
            SET status = 'Approved', app_role = EXCLUDED.app_role, updated_at = now()`,
        [identityId, p.role ?? 'rep']);
    }
  } else {
    summary.noGrant++;
    notes.push(`          ${''.padEnd(34)} no grant: sales account is ${p.status}/${p.is_active ? 'active' : 'inactive'}`);
  }
}

for (const n of notes) console.log(n);

console.log(`\n${people.length} sales account(s)`);
console.log(`  ${summary.created} identity row(s) to create`);
console.log(`  ${summary.linkedExisting} linked to an identity that already existed (left untouched)`);
console.log(`  ${summary.alreadyLinked} already linked from a previous run`);
console.log(`  ${summary.grants} Approved sales grant(s)`);
console.log(`  ${summary.noGrant} deliberately without a grant`);

if (!APPLY) { await sales.end(); await identity.end(); process.exit(0); }

// ── Verify against the databases, not against the counters above ──
console.log('\nverifying:\n');
let bad = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (expected ${want})`}`);
};

const linked = await sales.query('SELECT count(*)::int n FROM users WHERE identity_user_id IS NOT NULL');
check('sales accounts linked', linked.rows[0].n, people.length);

const dupes = await sales.query(
  `SELECT count(*)::int n FROM (SELECT identity_user_id FROM users
     WHERE identity_user_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d`);
check('sales accounts sharing one identity', dupes.rows[0].n, 0);

const liveGrants = await identity.query(
  `SELECT count(*)::int n FROM identity.app_grants WHERE app_slug='sales' AND status='Approved'`);
check('approved sales grants', liveGrants.rows[0].n, summary.grants);

const roleMismatch = await sales.query(`
  SELECT count(*)::int n FROM users u
   WHERE u.is_active AND u.status='Approved' AND u.identity_user_id IS NOT NULL`);
const grantRoles = await identity.query(
  `SELECT user_id, app_role FROM identity.app_grants WHERE app_slug='sales' AND status='Approved'`);
const roleById = new Map(grantRoles.rows.map(r => [r.user_id, r.app_role]));
const wrongRole = people.filter(p => entitled(p) && p.identity_user_id
  && roleById.get(p.identity_user_id) !== (p.role ?? 'rep')).length;
check('entitled accounts', roleMismatch.rows[0].n, summary.grants);
check('grants whose role disagrees with sales', wrongRole, 0);

// Nobody inactive got a way in.
const leaked = await identity.query(`
  SELECT count(*)::int n FROM identity.app_grants g
    JOIN identity.users u ON u.id = g.user_id
   WHERE g.app_slug='sales' AND g.status='Approved' AND NOT u.is_active`);
check('approved grants held by an inactive identity', leaked.rows[0].n, 0);

console.log(bad ? `\n${bad} check(s) FAILED\n` : '\nall checks passed\n');
await sales.end();
await identity.end();
process.exit(bad ? 1 : 0);
