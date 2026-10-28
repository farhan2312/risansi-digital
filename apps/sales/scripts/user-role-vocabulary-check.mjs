#!/usr/bin/env node
// The roles the code knows, the roles the column may hold, and the roles the
// hub can hand out must all be the same set.
//
// On 23 Oct 2026 three people were granted the sales role 'viewer' on the hub
// and none of them could get in. 'viewer' and 'registry' had been added to
// RisansiRole and ROLE_LEVEL here, and catalogued as grantable app_roles in
// migrations/identity/0009, but users_role_check in this database still read
// the five roles 0069 left behind. A person approved on the hub has no row in
// `users` until their first arrival; salesRowFor() creates it carrying the
// grant's role, that INSERT hit the check constraint, the error was caught and
// the function returned null — which the portal renders as "no session", i.e.
// the hub tile apparently reloading the hub.
//
// Nobody with an existing row was affected, so the only symptom was three
// people saying login was broken, a week after the deploy that broke it. This
// check compares the three lists so that cannot happen silently again.
//
// Static on purpose: no database, so it runs on Vercel like the other guards.
// The migration files are the declaration of what production holds, which is
// true as long as migrations are applied — `npm run migrate:status` is the
// separate check for that.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const AUTH = path.join(ROOT, 'lib', 'risansi-auth.ts');
const MIGRATIONS = path.join(ROOT, 'migrations');
// The hub's own migrations, two levels up. Present in a full checkout; a
// deploy that uploads only this app will not have them, and that is handled.
const IDENTITY_MIGRATIONS = path.join(ROOT, '..', '..', 'migrations', 'identity');

const fail = (lines) => {
  console.error('');
  for (const l of lines) console.error('  ' + l);
  console.error('');
  process.exit(1);
};

// A role named in a comment is a mention, not a declaration.
const stripComments = (sql) =>
  sql.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n');

// ── What the code knows: the keys of ROLE_LEVEL ──────────────────
const authSrc = readFileSync(AUTH, 'utf8');
const levelBlock = authSrc.match(/ROLE_LEVEL:\s*Record<RisansiRole,\s*number>\s*=\s*\{([\s\S]*?)\}/);
if (!levelBlock) {
  fail([
    'Could not find ROLE_LEVEL in lib/risansi-auth.ts.',
    'This check reads it to learn the sales role vocabulary. If the declaration',
    'moved or was renamed, update scripts/user-role-vocabulary-check.mjs to match.',
  ]);
}
const codeRoles = [...levelBlock[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map(m => m[1]);
if (codeRoles.length === 0) fail(['ROLE_LEVEL in lib/risansi-auth.ts parsed as empty.']);

// ── What the column may hold: the newest migration that sets the check ──
const sqlFiles = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
let source = null, dbRoles = null;
for (const file of sqlFiles) {
  const stmt = stripComments(readFileSync(path.join(MIGRATIONS, file), 'utf8'))
    .match(/ADD\s+CONSTRAINT\s+users_role_check\s+CHECK\s*\(([\s\S]*?)\)\s*;/i);
  if (!stmt) continue;
  const roles = [...stmt[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  if (roles.length) { source = file; dbRoles = roles; }
}
if (!dbRoles) {
  fail([
    'No migration defines users_role_check.',
    'The sales role vocabulary has to be constrained in the database as well as',
    'in the type, or an unknown role reaches the column and scores level 0.',
  ]);
}

const missingInDb   = codeRoles.filter(r => !dbRoles.includes(r));
const missingInCode = dbRoles.filter(r => !codeRoles.includes(r));

if (missingInDb.length || missingInCode.length) {
  const lines = ['The sales role vocabulary disagrees with itself.', ''];
  lines.push(`  lib/risansi-auth.ts  ROLE_LEVEL: ${codeRoles.join(', ')}`);
  lines.push(`  migrations/${source}: ${dbRoles.join(', ')}`);
  lines.push('');
  if (missingInDb.length) {
    lines.push(`users_role_check cannot hold: ${missingInDb.join(', ')}`);
    lines.push('A person granted one of these on the hub has no row in `users` yet, and the');
    lines.push('INSERT that would create it is refused — they get no session and are sent');
    lines.push('back to the hub. Add a migration widening the constraint.');
  }
  if (missingInCode.length) {
    lines.push(`The column accepts roles the code has never heard of: ${missingInCode.join(', ')}`);
    lines.push('Anything outside ROLE_LEVEL scores level 0, so it satisfies no permission');
    lines.push('test and opens nothing. Either add it to RisansiRole or drop it from the check.');
  }
  fail(lines);
}

// ── What an approver can hand out: identity.app_roles ────────────
//
// The third list, and the one that starts the trouble. The hub's approval
// screen offers whatever sits in identity.app_roles for app_slug 'sales', and
// a grant is the only thing this portal reads a role from. A role offered
// there and unknown here does not fail loudly: it scores level 0, satisfies no
// permission test and opens nothing by name, so the person signs in to a
// portal that refuses them everywhere. Same class of bug, quieter symptom.
let grantable = null;
try {
  grantable = new Set();
  for (const file of readdirSync(IDENTITY_MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    const sql = stripComments(readFileSync(path.join(IDENTITY_MIGRATIONS, file), 'utf8'));
    for (const insert of sql.matchAll(/INSERT\s+INTO\s+identity\.app_roles[\s\S]*?;/gi)) {
      for (const row of insert[0].matchAll(/\(\s*'sales'\s*,\s*'([a-z_]+)'/g)) grantable.add(row[1]);
    }
  }
} catch {
  grantable = null;   // not a full checkout; a local run and CI still cover it
}

if (grantable && grantable.size) {
  const unknown = [...grantable].filter(r => !codeRoles.includes(r));
  if (unknown.length) {
    fail([
      'The hub can grant sales roles this portal has never heard of.',
      '',
      `  migrations/identity/* offers: ${[...grantable].sort().join(', ')}`,
      `  lib/risansi-auth.ts knows:    ${[...codeRoles].sort().join(', ')}`,
      '',
      `Not known here: ${unknown.join(', ')}`,
      'An approver can hand one of these out today. Anything outside ROLE_LEVEL',
      'scores level 0, so the person signs in and every page refuses them. Add it',
      'to RisansiRole, ROLE_LEVEL, lib/risansi-role-paths.ts and users_role_check,',
      'or take it out of the identity catalogue.',
    ]);
  }
}

const seen = grantable && grantable.size ? `, all ${grantable.size} grantable on the hub` : '';
console.log(`✓ sales roles: ${codeRoles.length} in ROLE_LEVEL, same ${dbRoles.length} in users_role_check (${source})${seen}`);
