// Creates Risansi Digital hub accounts for SO to Dispatch users who have none,
// each with an Approved `so2dispatch` grant in the role they hold here — what
// the hub's own "Add person" does, for several people at once.
//
// Usage (emails of accounts in this portal, space or comma separated):
//   npm run db:create:identity -- a@risansi.com b@risansi.com            dry run, writes nothing
//   npm run db:create:identity -- --apply a@risansi.com b@risansi.com    creates them
//
// No password is set. password_hash stays null, so nobody can sign in until an
// approver issues one from the hub (People → Reset password), which shows it
// once and sets must_change_password. This script never makes or prints a
// password.
//
// Never overlaps with what exists. A person is created only when:
//   - the email is an approved account in this portal
//   - no hub account has that lower(email) — checked again inside the insert
//   - their role here is a role the hub knows for so2dispatch
// Each person is one transaction (account + grant + audit row), as in the hub.
// Running it twice changes nothing the second time.
//
// Needs DATABASE_URL (ec_to_dispatch) and IDENTITY_DB_* in .env.local.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Load .env.local (then .env), as migrate.mjs does.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
      const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) continue;
      const key = match[1];
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // file not present — ignore
  }
}

const APP_SLUG = "so2dispatch";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const emails = [...new Set(
  args.filter((a) => !a.startsWith("--")).flatMap((a) => a.split(",")).map((e) => e.trim().toLowerCase()).filter(Boolean)
)];
if (!emails.length) {
  console.error("Give the emails to create, e.g. npm run db:create:identity -- a@risansi.com b@risansi.com");
  process.exit(1);
}

const env = process.env;
for (const key of ["DATABASE_URL", "IDENTITY_DB_HOST", "IDENTITY_DB_NAME", "IDENTITY_DB_USER", "IDENTITY_DB_PASSWORD"]) {
  if (!env[key]) {
    console.error(`${key} is not set in .env.local.`);
    process.exit(1);
  }
}

const ssl = { rejectUnauthorized: false };
const ec = new pg.Client({ connectionString: env.DATABASE_URL, ssl });
const identity = new pg.Client({
  host: env.IDENTITY_DB_HOST,
  port: Number(env.IDENTITY_DB_PORT || 5432),
  database: env.IDENTITY_DB_NAME,
  user: env.IDENTITY_DB_USER,
  password: env.IDENTITY_DB_PASSWORD,
  ssl,
});

try {
  await ec.connect();
  await identity.connect();

  const { rows: users } = await ec.query(
    `SELECT full_name, email, role, status FROM users WHERE lower(email) = ANY($1)`,
    [emails]
  );
  const local = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const taken = new Set(
    (await identity.query(`SELECT lower(email) AS e FROM identity.users WHERE lower(email) = ANY($1)`, [emails])).rows.map((r) => r.e)
  );
  const hubRoles = new Set(
    (await identity.query(`SELECT role FROM identity.app_roles WHERE app_slug = $1`, [APP_SLUG])).rows.map((r) => r.role)
  );

  const create = [];
  const skip = [];
  for (const email of emails) {
    const user = local.get(email);
    if (!user) skip.push({ email, reason: "no account in SO to Dispatch" });
    else if (user.status !== "approved") skip.push({ email, reason: `account here is ${user.status}` });
    else if (taken.has(email)) skip.push({ email, reason: "already has a hub account" });
    else if (!hubRoles.has(user.role)) skip.push({ email, reason: `role "${user.role}" not known to the hub` });
    else create.push(user);
  }

  const pad = (s, n) => String(s ?? "").padEnd(n);
  console.log(`WILL CREATE — hub account, no password, Approved ${APP_SLUG} grant (${create.length})`);
  for (const u of create) console.log(`  ${pad(u.full_name, 22)} ${pad(u.email, 34)} ${u.role}`);
  console.log(`\nSKIPPED (${skip.length})`);
  for (const s of skip) console.log(`  ${pad(s.email, 34)} ${s.reason}`);

  if (!apply) {
    console.log(`\nDry run — nothing written. Re-run with --apply to create ${create.length} account(s).`);
  } else {
    let done = 0;
    for (const u of create) {
      await identity.query("BEGIN");
      try {
        // WHERE NOT EXISTS: somebody added at the hub since the check above is left alone.
        const { rows } = await identity.query(
          `INSERT INTO identity.users (email, name, password_hash, must_change_password, is_active, role)
           SELECT $1, $2, NULL, true, true, 'member'
            WHERE NOT EXISTS (SELECT 1 FROM identity.users WHERE lower(email) = lower($1))
           RETURNING id`,
          [u.email.trim(), u.full_name.trim()]
        );
        if (!rows[0]) {
          await identity.query("ROLLBACK");
          console.log(`  skipped ${u.email}: hub account appeared meanwhile`);
          continue;
        }
        await identity.query(
          `INSERT INTO identity.app_grants (user_id, app_slug, status, app_role, decided_at, decided_note)
           VALUES ($1, $2, 'Approved', $3, now(), $4)`,
          [rows[0].id, APP_SLUG, u.role, "Granted at account creation: role carried over from SO to Dispatch (Phase 5)."]
        );
        await identity.query(
          `INSERT INTO identity.auth_events (event, email, user_id, app_slug, detail)
           VALUES ('user_created', $1, $2, $3, $4)`,
          [u.email, rows[0].id, APP_SLUG, `created from SO to Dispatch (Phase 5 script), granted ${APP_SLUG}:${u.role}, no password set`]
        );
        await identity.query("COMMIT");
        done++;
      } catch (error) {
        await identity.query("ROLLBACK").catch(() => {});
        console.log(`  failed ${u.email}: ${error instanceof Error ? error.message : error}`);
      }
    }
    console.log(`\nCreated ${done} hub account(s). Passwords: issue each from the hub (People → Reset password).`);
    console.log(`Next: npm run db:seed:identity`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await ec.end().catch(() => {});
  await identity.end().catch(() => {});
}
