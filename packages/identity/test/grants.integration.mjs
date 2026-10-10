/**
 * Drives the grant functions against a real Postgres. Opt-in, because it needs
 * a database and the unit tests do not.
 *
 * Run it from `apps/hub`, which is where `pg` is installed — this package does
 * not depend on `pg` itself, by design, because its query functions take a
 * client rather than opening one:
 *
 *   cd apps/hub
 *   node --experimental-strip-types ../../packages/identity/test/grants.integration.mjs
 *
 * with IDENTITY_DB_HOST / _USER / _PASSWORD / _NAME set, which `apps/hub/.env.local`
 * already carries. (ESM resolution ignores NODE_PATH, so running it from the
 * repo root with a borrowed node_modules will not work.)
 *
 * Creates one throwaway user, exercises every state transition, and deletes it.
 * It writes only to rows it created, so it is safe against the live identity
 * database — which is also the only place the schema actually exists.
 *
 * Worth keeping rather than deleting after one run: the first version of
 * `requestAccess` reported a repeat request on an already-Pending grant as
 * "reopened", because RETURNING can only see the new row and so cannot tell a
 * no-op from a genuine reinstatement. The data was right and the message was
 * wrong, which is exactly the class of bug that reads fine and never shows up
 * until somebody is told their access was restored when it was not.
 */

import pg from 'pg';

const M = await import('../src/grants.ts');

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.log(`skipped: ${k} is not set`); process.exit(0); }
  return v;
};

const c = new pg.Client({
  host: need('IDENTITY_DB_HOST'),
  port: Number(process.env.IDENTITY_DB_PORT) || 5432,
  database: process.env.IDENTITY_DB_NAME || 'risansi_identity',
  user: need('IDENTITY_DB_USER'),
  password: need('IDENTITY_DB_PASSWORD'),
  ssl: { rejectUnauthorized: process.env.IDENTITY_DB_SSL_INSECURE !== '1' },
  connectionTimeoutMillis: 15_000,
});
await c.connect();

const EMAIL = 'zz-throwaway-check@risansi.com';
let fails = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`
    + (ok ? '' : `\n         got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
};

await c.query('DELETE FROM identity.users WHERE lower(email) = $1', [EMAIL]);
const { rows } = await c.query(
  `INSERT INTO identity.users (email, name) VALUES ($1,'Throwaway Check') RETURNING id`, [EMAIL]);
const uid = rows[0].id;

try {
  let r = await M.mayOpen(c, uid, 'select');
  check('an application needing no grant is open to anyone signed in', r.allowed, true);

  r = await M.mayOpen(c, uid, 'sales');
  check('one that needs a grant is refused before asking', r.allowed, false);

  const tiles = await M.tilesFor(c, uid);
  check('every live application appears on the grid', tiles.length, 4);
  check('an unasked tile offers a request', M.tileState(tiles.find(t => t.slug === 'sales')), 'request');
  check('an ungated tile is already open', M.tileState(tiles.find(t => t.slug === 'select')), 'open');

  let a = await M.requestAccess(c, uid, 'sales', 'Need the pipeline for the west region.');
  check('the first request inserts', a.state, 'created');
  r = await M.mayOpen(c, uid, 'sales');
  check('pending is still refused', r.allowed, false);
  check('and says why', r.reason, 'Your request for access is waiting to be approved.');

  a = await M.requestAccess(c, uid, 'sales', 'asking again');
  check('asking again while pending changes nothing', a.state, 'unchanged');
  const n = await c.query(
    `SELECT count(*)::int AS n, max(requested_reason) AS reason FROM identity.app_grants
      WHERE user_id = $1 AND app_slug = 'sales'`, [uid]);
  check('there is still exactly one grant row', n.rows[0].n, 1);
  check('and the original reason survives', n.rows[0].reason, 'Need the pipeline for the west region.');

  await c.query(
    `UPDATE identity.app_grants SET status='Approved', app_role='manager', decided_at=now()
      WHERE user_id=$1 AND app_slug='sales'`, [uid]);
  r = await M.mayOpen(c, uid, 'sales');
  check('approved means allowed', r.allowed, true);
  check('and carries the portal-specific role', r.appRole, 'manager');

  a = await M.requestAccess(c, uid, 'sales', 'please again');
  check('re-requesting something held changes nothing', a.state, 'unchanged');
  r = await M.mayOpen(c, uid, 'sales');
  check('and must not knock it back to pending', r.allowed, true);

  await c.query(`UPDATE identity.app_grants SET status='Revoked' WHERE user_id=$1 AND app_slug='sales'`, [uid]);
  r = await M.mayOpen(c, uid, 'sales');
  check('revoked means refused', r.allowed, false);
  check('with the withdrawal wording, not the rejection wording',
    r.reason, 'Your access to this application was withdrawn.');

  a = await M.requestAccess(c, uid, 'sales', 'after revoke');
  check('asking again after a revoke reopens the same row', a.state, 'reopened');
  const re = await c.query(
    `SELECT status, requested_reason, decided_at FROM identity.app_grants
      WHERE user_id=$1 AND app_slug='sales'`, [uid]);
  check('back to pending', re.rows[0].status, 'Pending');
  check('carrying the new reason', re.rows[0].requested_reason, 'after revoke');
  check('with the previous decision cleared', re.rows[0].decided_at, null);

  await c.query(`UPDATE identity.app_grants SET status='Approved' WHERE user_id=$1`, [uid]);
  await c.query('UPDATE identity.users SET is_active = false WHERE id = $1', [uid]);
  r = await M.mayOpen(c, uid, 'sales');
  check('deactivating the person overrides an approved grant', r.allowed, false);
  r = await M.mayOpen(c, uid, 'select');
  check('and closes even the ungated applications', r.allowed, false);
} finally {
  await c.query('DELETE FROM identity.users WHERE id = $1', [uid]);
  const g = await c.query('SELECT count(*)::int AS n FROM identity.app_grants WHERE user_id = $1', [uid]);
  check('deleting the person cascades their grants away', g.rows[0].n, 0);
}

console.log(fails ? `\n${fails} check(s) failed\n` : '\nall checks passed\n');
await c.end();
process.exit(fails ? 1 : 0);
