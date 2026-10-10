// 0002  Seed `users` from the authoritative roster (Excel) supplied by the org.
//
//   * Existing reps are matched BY EMAIL and reuse their reps.id (so existing
//     rep_id FK values stay valid for the later cutover). Wrong roles are fixed.
//   * People absent from reps (Vishal Gaikwad, Mohammed Farhan, Risansi Admin)
//     get fresh ids above the current max.
//   * Junk reps (qwerty #7, rep2 #18, "manager" #19) are intentionally NOT
//     carried over.
//   * Passwords: Farhan + admin get their explicit passwords (no forced reset);
//     everyone else gets a shared temp password and must_change_password = true.

import bcrypt from 'bcryptjs';

const TEMP_PASSWORD = 'Risansi@2026';

// [name, email, role, explicitPassword|null]
const ROSTER = [
  ['Aviral Shukla',     'aviral.shukla@risansi.com',     'manager',  null],
  ['Akshay Awasthi',    'akshay.awasthi@risansi.com',    'rep',      null],
  ['Himanshu Kushwaha', 'himanshu.kushwaha@risansi.com', 'rep',      null],
  ['Amit Srivastava',   'northindia2@risansi.com',       'rep',      null],
  ['Anil Vankudre',     'anil.vankudre@risansi.com',     'manager',  null],
  ['Madhav R Kulkarni', 'madhav.kulkarni@risansi.com',   'manager',  null],
  ['Vishal Gaikwad',    'westindia1@risansi.com',        'rep',      null],
  ['Prashant Dhere',    'westindia2@risansi.com',        'rep',      null],
  ['Sudhir Vichare',    'sudhir.vichare@risansi.com',    'rep',      null],
  ['Guna Sekaran',      'guna.sekaran@risansi.com',      'manager',  null],
  ['Vikram Bharadwaj',  'vikram.bharadwaj@risansi.com',  'rep',      null],
  ['Manoj Gupta',       'manoj.gupta@risansi.com',       'rep',      null],
  ['Anton Kozin',       'akozin@risansi.com',            'rep',      null],
  ['Bernardo Espinola', 'bernardo@risansi.com',          'rep',      null],
  ['Rajesh Thatha',     'rthatha@risansi.com',           'rep',      null],
  ['Susanta Pande',     'rekayasa.bakti@risansi.com',    'rep',      null],
  ['Shivanu Shukla',    'shivanu@risansi.com',           'manager',  null],
  ['Mohammed Farhan',   'mfarhan@risansi.com',           'sysadmin', 'farhan2312'],
  ['Risansi Admin',     'admin@risansi.com',             'sysadmin', 'risansi12345'],
];

function initialsOf(name) {
  const w = name.trim().split(/\s+/);
  const first = w[0]?.[0] ?? '';
  const last  = w.length > 1 ? w[w.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export default async function (client) {
  const { rows: reps } = await client.query(
    'SELECT id, lower(email) AS email, rep_code, initials, zone, route, target_cr FROM reps',
  );
  const byEmail = new Map(reps.map(r => [r.email, r]));
  let maxId = reps.reduce((m, r) => Math.max(m, r.id), 0);

  for (const [name, email, role, explicitPw] of ROSTER) {
    const existing = byEmail.get(email.toLowerCase());
    const id = existing ? existing.id : ++maxId;

    const password     = explicitPw ?? TEMP_PASSWORD;
    const mustChange    = explicitPw ? false : true;
    const passwordHash = await bcrypt.hash(password, 10);

    const initials = existing?.initials ?? initialsOf(name);
    const repCode  = existing?.rep_code ?? initials;
    const zone     = existing?.zone     ?? null;
    const route    = existing?.route    ?? null;
    const targetCr = existing?.target_cr ?? null;

    await client.query(
      `INSERT INTO users
         (id, email, name, role, password_hash, must_change_password,
          is_active, status, rep_code, initials, zone, route, target_cr)
       VALUES ($1,$2,$3,$4,$5,$6,true,'Approved',$7,$8,$9,$10,$11)
       ON CONFLICT (lower(email)) DO UPDATE SET
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         password_hash = EXCLUDED.password_hash,
         must_change_password = EXCLUDED.must_change_password,
         is_active = true,
         status = 'Approved',
         updated_at = now()`,
      [id, email.toLowerCase(), name, role, passwordHash, mustChange,
       repCode, initials, zone, route, targetCr],
    );
  }

  // Move the identity sequence past every explicitly-inserted id so future
  // inserts (sysadmin "add user" page) don't collide.
  await client.query(
    `SELECT setval(pg_get_serial_sequence('users','id'),
                   (SELECT COALESCE(MAX(id),1) FROM users), true)`,
  );

  const { rows: [{ count }] } = await client.query('SELECT COUNT(*)::int AS count FROM users');
  console.log(`seeded users (total now ${count})`);
}
