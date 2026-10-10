#!/usr/bin/env node
// What a `staff` user can and cannot reach.
//
//   node scripts/staff-role-check.mjs
//
// The role was added specifically because the existing model is a ranking and
// these people are not on it. That claim is only worth anything if the level-0
// role really does satisfy no rung and really is refused by the record-scope
// helpers, so this asserts both against the actual functions rather than
// against my reading of them.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.sr-'));

// risansi-auth pulls in next-auth and the pool at import time; only the pure
// helpers are under test, so they are transpiled with those imports stubbed.
const src = fs.readFileSync(path.join(ROOT, 'lib', 'risansi-auth.ts'), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/export const getCurrentUser = cache\([\s\S]*?\n\}\);/m, '')
  .replace(/export const requireSession = cache\([\s\S]*?\n\}\);/m, '')
  .replace(/const getSession = cache\([\s\S]*?\);/m, '');
fs.writeFileSync(path.join(tmp, 'auth.mjs'), ts.transpileModule(src, {
  fileName: 'lib/risansi-auth.ts',
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText);
const A = await import('file:///' + path.join(tmp, 'auth.mjs').split(path.sep).join('/'));

let bad = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(58)} ${got}`);
};

const staff = { id: 99, email: 's@risansi.com', role: 'staff', departments: ['QC'] };
const rep   = { id: 5,  email: 'r@risansi.com', role: 'rep', departments: [] };
const admin = { id: 1,  email: 'a@risansi.com', role: 'admin', departments: [] };

// The two shapes that broke the single-column model.
const storesAndDispatch = { id: 98, email: 'sd@risansi.com', role: 'staff', departments: ['Billing Team', 'Quotation Team'] };
const repWhoDispatches  = { id: 97, email: 'rd@risansi.com', role: 'rep',   departments: ['Complaint Team'] };

console.log('The ladder — staff must satisfy no rung:');
for (const r of ['rep', 'manager', 'admin', 'sysadmin']) {
  check(`hasRole('staff', '${r}')`, A.hasRole('staff', r), false);
}
check(`hasRole('rep', 'rep')`, A.hasRole('rep', 'rep'), true);
check(`hasRole('admin', 'admin')`, A.hasRole('admin', 'admin'), true);
check(`isStaff('staff')`, A.isStaff('staff'), true);
check(`isStaff('rep')`, A.isStaff('rep'), false);
// The trap this role could have fallen into: level 0 is also what an unknown
// role scores, so a gate written as hasRole(role,'staff') would admit everybody.
check(`isStaff(undefined) — an unknown role is not staff`, A.isStaff(undefined), false);

console.log('\nRecords — visits, opportunities, actions:');
check('clientScopeSql(staff) refuses everything', A.clientScopeSql(staff, 'x.client_id'), 'FALSE');
check('clientScopeSql(staff) refuses even own-open work',
  A.clientScopeSql(staff, 'x.client_id', 'o.rep_id = :uid'), 'FALSE');
check('clientScopeSql(rep) still scopes rather than refuses',
  typeof A.clientScopeSql(rep, 'x.client_id') === 'string'
    && A.clientScopeSql(rep, 'x.client_id') !== 'FALSE', true);
check('clientScopeSql(admin) unrestricted', A.clientScopeSql(admin, 'x.client_id'), 'null');

console.log('\nThe two explicit allowances:');
check('clientVisibilitySql(staff) — all clients', A.clientVisibilitySql(staff), 'null');
check('complaintVisibilitySql(staff) — all complaints', A.complaintVisibilitySql(staff), 'null');
check('clientVisibilitySql(rep) still narrowed',
  A.clientVisibilitySql(rep) !== null && A.clientVisibilitySql(rep) !== 'FALSE', true);

console.log('\nDepartments:');
check("isDepartment('QC')", A.isDepartment('QC'), true);
check("isDepartment('quality') — case matters, the CHECK is exact", A.isDepartment('quality'), false);
check("isDepartment('Marketing')", A.isDepartment('Marketing'), false);
check('DEPARTMENTS count', A.DEPARTMENTS.length, 5);

console.log('\n  one person, two departments:');
check('holds Billing Team', A.hasDepartment(storesAndDispatch, 'Billing Team'), true);
check('holds Quotation Team', A.hasDepartment(storesAndDispatch, 'Quotation Team'), true);
check('does not hold QC', A.hasDepartment(storesAndDispatch, 'QC'), false);
check('passes a stage owned by Stores OR Accounts',
  A.hasAnyDepartment(storesAndDispatch, ['Billing Team', 'Purchase']), true);
check('fails a stage owned by Quality OR Purchase',
  A.hasAnyDepartment(storesAndDispatch, ['QC', 'Purchase']), false);

console.log('\n  a rep who also handles dispatch keeps everything a rep has:');
check('holds Complaint Team', A.hasDepartment(repWhoDispatches, 'Complaint Team'), true);
check('hasRole rep — unchanged by the department', A.hasRole(repWhoDispatches.role, 'rep'), true);
check('is NOT staff', A.isStaff(repWhoDispatches.role), false);
check('records still scoped, not refused',
  A.clientScopeSql(repWhoDispatches, 'x.client_id') !== 'FALSE', true);
check('clients still narrowed to their own',
  A.clientVisibilitySql(repWhoDispatches) !== null, true);

console.log('\n  and a department grants no sales access on its own:');
check('staff with Stores+Dispatch still refused every record',
  A.clientScopeSql(storesAndDispatch, 'x.client_id'), 'FALSE');

// The route allowlist in proxy.ts, read from the file so it cannot drift.
console.log('\nRoute gate (proxy.ts):');
const proxy = fs.readFileSync(path.join(ROOT, 'proxy.ts'), 'utf8');
const allowed = [...proxy.matchAll(/^\s*'(\/[a-z/-]+)',$/gm)].map(m => m[1])
  .filter(p => !p.includes(':path'));
console.log(`  allowlist: ${allowed.join(', ')}`);
const reach = (p) => allowed.some(a => p === a || p.startsWith(`${a}/`));
for (const [p, want] of [
  ['/risansi/clients', true], ['/risansi/clients/123', true],
  ['/risansi/complaints', true], ['/print/client/ABC01', true],
  ['/risansi', false], ['/risansi/pipeline', false], ['/risansi/revenue', false],
  ['/risansi/field', false], ['/risansi/executive-review', false],
  ['/risansi/admin/audit', false], ['/admin', false], ['/risansi/registry', false],
]) check(`staff may open ${p}`, reach(p), want);

// And the database really does accept the new values.
console.log('\nDatabase:');
const env = {};
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const pool = new pg.Pool({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
const { rows: [c] } = await pool.query(
  `SELECT pg_get_constraintdef(con.oid) def FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'users' AND con.conname = 'users_role_check'`);
check("role check admits 'staff'", /staff/.test(c?.def ?? ''), true);
const { rows: [d] } = await pool.query(
  `SELECT count(*)::int n FROM information_schema.tables
    WHERE table_schema='public' AND table_name='user_departments'`);
check('user_departments table exists', d.n, 1);

// The table itself has to accept two rows for one person and refuse a value
// that is not on the list. Done in a transaction that is always rolled back.
const client = await pool.connect();
const { rows: [someone] } = await client.query('SELECT id FROM users LIMIT 1');
await client.query('BEGIN');
await client.query(
  `INSERT INTO user_departments (user_id, department) VALUES ($1,'Billing Team'),($1,'Quotation Team')`,
  [someone.id]);
const { rows: [held] } = await client.query(
  `SELECT count(*)::int n FROM user_departments WHERE user_id = $1`, [someone.id]);
check('one user can hold two departments', held.n, 2);
let refused = false;
try {
  await client.query('SAVEPOINT s');
  await client.query(`INSERT INTO user_departments (user_id, department) VALUES ($1,'Marketing')`, [someone.id]);
} catch { refused = true; await client.query('ROLLBACK TO SAVEPOINT s'); }
check('the database refuses a department that is not on the list', refused, true);
await client.query('ROLLBACK');
const { rows: [left] } = await client.query('SELECT count(*)::int n FROM user_departments');
check('nothing left behind after rollback', left.n, 0);
client.release();

// Nobody is staff yet, and every existing user kept their role.
const { rows: r } = await pool.query(`SELECT role, count(*)::int n FROM users GROUP BY 1 ORDER BY 1`);
console.log(`  roles in use: ${r.map(x => `${x.role}=${x.n}`).join(', ')}`);

await pool.end();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILURE(S)` : '\nstaff satisfies no rung, is refused every record, and reaches exactly two areas');
process.exit(bad ? 1 : 0);
