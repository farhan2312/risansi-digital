/**
 * Phase 4 seed — Testing Portal and Pump Selection into identity.
 *
 * Dry by default. Pass --apply to write.
 *
 * ── What this touches, and what it deliberately does not ─────────
 *
 * It writes to `risansi_identity` and nowhere else. Both portals still run on
 * their own `users` / `users_pump` tables and neither reads identity yet, so
 * running this changes nothing anybody can see. That is the point: the seed
 * can be run, inspected, and run again long before the two apps swap their
 * sign-in, and if it is wrong nobody is locked out of anything.
 *
 * In particular it does NOT deactivate anything in `Pump_Selector_and_testing`.
 * Retiring an account there is a change to a live portal owned by another
 * team, and it is unnecessary: an account with no identity row simply cannot
 * sign in once the swap happens, so leaving it alone retires it on the day
 * rather than before.
 *
 * ── Four rules, same as the sales seed ───────────────────────────
 *
 * 1. Never overwrite an identity row that already exists. Eighteen of these
 *    people arrived from sales first and that row is the one in use.
 * 2. Carry the bcrypt hash for anybody new, so nobody is handed a temporary
 *    password for an account they already had. Every hash in both tables is
 *    `$2b$`, which is what sales uses and what bcryptjs reads.
 * 3. No grant for an inactive account.
 * 4. Never change a decision somebody already made. A grant that exists is
 *    left exactly as it is, including a Rejected one, and reported instead —
 *    overwriting a refusal with an approval because a row happens to exist in
 *    the old table is how a refusal silently stops meaning anything.
 *
 * ── Who is excluded, decided 11 Oct 2026 ─────────────────────────
 *
 * Shared and role mailboxes `centraladmin@`, `it@`, `testing@`: retired. Two
 * were never signed into and the third has no activity.
 *
 * Test logins `source001@`, `test02@`, `testing001@`: not carried, although
 * they are genuinely used (73 audit entries between them). They stop working
 * at cutover, which is a known and accepted consequence — the testers use
 * their own accounts instead.
 *
 * `narendrakushwaha@` ("DRG"): one person, two accounts. `narendra.kushwaha@`
 * is the one kept. The session and audit rows belonging to the DRG account
 * are left pointing at it rather than moved: on that date somebody did sign
 * in as that address, and re-pointing an audit row changes what the log says
 * happened. Same decision as the `marketing@` merge on 10 Oct.
 *
 * `admin@`: already retired in identity, and its cleanup in these two portals
 * is waiting on the conversation with their developers.
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

/** Not people, or not carried. See the header for why each one. */
const EXCLUDE = new Set([
  'centraladmin@risansi.com', 'it@risansi.com', 'testing@risansi.com',
  'source001@risansi.com', 'test02@risansi.com', 'testing001@risansi.com',
  'narendrakushwaha@risansi.com',
  'admin@risansi.com',
]);

/** Only where the source portal is the sole record of the name and it is a
 *  first name alone. Derived from the address, like every other full name. */
const RENAME = new Map([['sachin.tripathi@risansi.com', 'Sachin Tripathi']]);

const GRANT_NOTE =
  "Carried from the portal's own user table at the Phase 4 seed, 11 Oct 2026.";

const src = new pg.Client({
  host: sales.DB_HOST, port: Number(sales.DB_PORT) || 5432,
  database: 'Pump_Selector_and_testing', user: sales.DB_USER, password: sales.DB_PASSWORD,
  ssl: { rejectUnauthorized: true },
});
await src.connect();
const testing = (await src.query(
  `SELECT lower(trim(email)) email, name, role, lower(status) status,
          password_hash, must_change_password
     FROM public.users ORDER BY email`)).rows;
const pump = (await src.query(
  `SELECT lower(trim(email)) email, name, role, lower(status) status,
          password_hash, must_change_password
     FROM public.users_pump ORDER BY email`)).rows;
await src.end();

const live = (r) => !EXCLUDE.has(r.email) && (r.status === 'active' || r.status === 'approved');
const T = testing.filter(live);
const P = pump.filter(live);

const id = new pg.Client({
  host: hub.IDENTITY_DB_HOST, port: Number(hub.IDENTITY_DB_PORT) || 5432,
  database: hub.IDENTITY_DB_NAME, user: hub.IDENTITY_DB_USER,
  password: hub.IDENTITY_DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
await id.connect();

const reload = async () => {
  const m = new Map();
  for (const r of (await id.query(
    `SELECT lower(email) email, id::text id, is_active FROM identity.users`)).rows) m.set(r.email, r);
  return m;
};
let known = await reload();

// ── 1. People with no identity row yet ────────────────────────────
const seen = new Map();
for (const r of [...T, ...P]) if (!seen.has(r.email)) seen.set(r.email, r);
const toCreate = [...seen.values()].filter(r => !known.has(r.email));

console.log(`\n── new identity rows (${toCreate.length}) ──`);
console.table(toCreate.map(r => ({
  email: r.email, name: RENAME.get(r.email) ?? r.name,
  hash: r.password_hash ? r.password_hash.slice(0, 4) : '(none)',
  mustChange: r.must_change_password,
})));

if (APPLY) {
  for (const r of toCreate) {
    await id.query(
      `INSERT INTO identity.users (email, name, password_hash, must_change_password, is_active, role)
       SELECT $1, $2, $3, $4, true, 'member'
        WHERE NOT EXISTS (SELECT 1 FROM identity.users WHERE lower(email) = lower($1))`,
      [r.email, RENAME.get(r.email) ?? r.name, r.password_hash, r.must_change_password ?? false]);
  }
  known = await reload();
}

// A name correction for somebody who already had an identity row.
for (const [email, name] of RENAME) {
  if (!known.has(email) || toCreate.some(r => r.email === email)) continue;
  console.log(`rename existing identity row: ${email} -> ${name}`);
  if (APPLY) await id.query(`UPDATE identity.users SET name = $2 WHERE lower(email) = $1`, [email, name]);
}

// ── 2. Grants ─────────────────────────────────────────────────────
const wanted = [
  ...T.map(r => ({ app: 'testing', email: r.email, role: r.role })),
  ...P.map(r => ({ app: 'select',  email: r.email, role: r.role })),
];

const existing = new Map((await id.query(
  `SELECT g.app_slug, lower(u.email) email, g.status, g.app_role
     FROM identity.app_grants g JOIN identity.users u ON u.id = g.user_id`)).rows
  .map(r => [`${r.app_slug}|${r.email}`, r]));

const create = [], already = [], blocked = [];
for (const w of wanted) {
  const who = known.get(w.email);
  if (!who) { blocked.push({ ...w, why: 'no identity row yet (dry run)' }); continue; }
  if (!who.is_active) { blocked.push({ ...w, why: 'identity row is inactive' }); continue; }
  const prior = existing.get(`${w.app}|${w.email}`);
  if (prior) { already.push({ ...w, status: prior.status, held: prior.app_role }); continue; }
  create.push({ ...w, userId: who.id });
}

console.log(`\n── grants to create (${create.length}) ──`);
console.table(create.map(({ app, email, role }) => ({ app, email, role })));
if (already.length) {
  console.log(`\n── already decided, left alone (${already.length}) ──`);
  console.table(already);
}
if (blocked.length) {
  console.log(`\n── not granted (${blocked.length}) ──`);
  console.table(blocked);
}

if (APPLY) {
  await id.query('BEGIN');
  try {
    for (const g of create) {
      await id.query(
        `INSERT INTO identity.app_grants (user_id, app_slug, status, app_role, decided_at, decided_note)
         VALUES ($1, $2, 'Approved', $3, now(), $4)
         ON CONFLICT (user_id, app_slug) DO NOTHING`,
        [g.userId, g.app, g.role, GRANT_NOTE]);
    }
    await id.query('COMMIT');
  } catch (e) { await id.query('ROLLBACK'); console.error('ROLLED BACK:', e.message); throw e; }
}

console.log(`\n${APPLY ? 'applied' : 'DRY RUN — nothing written'}`);
await id.end();
