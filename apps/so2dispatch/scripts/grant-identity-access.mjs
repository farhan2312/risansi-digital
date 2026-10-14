// Gives existing SO to Dispatch users an Approved `so2dispatch` grant at
// Risansi Digital, with the role they already hold here — so the hub does not
// have to approve them one by one before the identity seed can link them.
//
// Usage:
//   npm run db:grant:identity                      dry run: shows what would happen, writes nothing
//   npm run db:grant:identity -- --report FILE.md  dry run, plus the list as Markdown
//   npm run db:grant:identity -- --apply           writes the grants (agree it with Farhan first)
//   --role email=role                             grant a different role than the one held here (repeatable)
//
// Never overlaps with what exists. A grant is added only when ALL of these hold:
//   - the account here is approved
//   - an identity with the same lower(email) exists and is active
//   - that identity has NO so2dispatch grant yet, in any state — an existing
//     Approved, Pending, Rejected or Revoked grant is left exactly as it is
//     (a Rejected one is a decision somebody made at the hub)
//   - the role here is one the hub knows for so2dispatch (identity.app_roles)
//   - no other account here maps to the same identity
// It creates no identities: a person missing at the hub is listed, not made.
// The insert also carries ON CONFLICT DO NOTHING, so a grant added at the hub
// between the dry run and --apply is never overwritten. Running it twice
// changes nothing the second time.
//
// Needs DATABASE_URL (ec_to_dispatch) and IDENTITY_DB_* in .env.local.
import { readFileSync, writeFileSync } from "node:fs";
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
const NOTE = "Bulk grant: role carried over from SO to Dispatch (Phase 5)";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
// --role a@x.com=admin: the grant gets this role instead of the one held here.
const roleOverride = new Map(
  args.flatMap((a, i) => (a === "--role" ? [args[i + 1]] : []))
    .map((v) => v.split("=").map((p) => p.trim()))
    .map(([email, role]) => [email.toLowerCase(), role])
);
const reportPath = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;

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

  const { rows: identities } = await identity.query(
    `SELECT u.id, lower(u.email) AS email, u.name, u.is_active, g.status, g.app_role
       FROM identity.users u
       LEFT JOIN identity.app_grants g ON g.user_id = u.id AND g.app_slug = $1`,
    [APP_SLUG]
  );
  const byEmail = new Map(identities.map((r) => [r.email, r]));
  const hubRoles = new Set(
    (await identity.query(`SELECT role FROM identity.app_roles WHERE app_slug = $1`, [APP_SLUG])).rows.map((r) => r.role)
  );

  const { rows: users } = await ec.query(
    `SELECT id, full_name, email, role, status FROM users ORDER BY lower(email)`
  );
  // Two accounts here on one identity would be one grant for two people.
  const perIdentity = new Map();
  for (const u of users) {
    const found = byEmail.get(u.email.toLowerCase());
    if (found) perIdentity.set(found.id, (perIdentity.get(found.id) ?? 0) + 1);
  }

  const grant = [];    // { user, identity }
  const existing = []; // { user, identity } — grant already there, untouched
  const skip = [];     // { user, reason }
  for (const raw of users) {
    const override = roleOverride.get(raw.email.toLowerCase());
    const user = override ? { ...raw, role: override } : raw;
    const found = byEmail.get(user.email.toLowerCase());
    if (!found) skip.push({ user, reason: "no identity at the hub" });
    else if (found.status) existing.push({ user, identity: found });
    else if (user.status !== "approved") skip.push({ user, reason: `account here is ${user.status}` });
    else if (!found.is_active) skip.push({ user, reason: "identity is inactive" });
    else if (!hubRoles.has(user.role)) skip.push({ user, reason: `role "${user.role}" not known to the hub` });
    else if (perIdentity.get(found.id) > 1) skip.push({ user, reason: "several accounts here share this identity" });
    else grant.push({ user, identity: found });
  }

  const pad = (s, n) => String(s ?? "").padEnd(n);
  console.log(`Accounts here: ${users.length}   Identities: ${identities.length}   Hub roles for ${APP_SLUG}: ${hubRoles.size}\n`);
  console.log(`WILL GRANT — Approved, role from here (${grant.length})`);
  for (const { user } of grant) console.log(`  ${pad(user.email, 38)} ${user.role}`);
  console.log(`\nALREADY HAS A GRANT — left as it is (${existing.length})`);
  for (const { user, identity: i } of existing) {
    const note = i.status === "Approved" && i.app_role !== user.role ? `  (role here: ${user.role})` : "";
    console.log(`  ${pad(user.email, 38)} ${pad(i.status, 9)} ${i.app_role ?? ""}${note}`);
  }
  console.log(`\nSKIPPED (${skip.length})`);
  for (const { user, reason } of skip) console.log(`  ${pad(user.email, 38)} ${pad(user.role, 18)} ${reason}`);

  if (reportPath) {
    const row = (cells) => `| ${cells.join(" | ")} |`;
    const md = [
      `# SO to Dispatch — bulk grants`,
      ``,
      `Generated ${new Date().toISOString().slice(0, 10)} by \`npm run db:grant:identity\` (dry run).`,
      `Adds an Approved \`${APP_SLUG}\` grant, with the role held in SO to Dispatch, only where the identity has no grant at all. Existing grants are never changed.`,
      ``,
      `## Will grant (${grant.length})`,
      ``,
      row(["Email", "Name", "Role"]),
      row(["---", "---", "---"]),
      ...grant.map(({ user }) => row([user.email, user.full_name, user.role])),
      ``,
      `## Already has a grant — untouched (${existing.length})`,
      ``,
      row(["Email", "Name", "Grant", "Grant role", "Role here"]),
      row(["---", "---", "---", "---", "---"]),
      ...existing.map(({ user, identity: i }) => row([user.email, user.full_name, i.status, i.app_role ?? "", user.role])),
      ``,
      `## Skipped (${skip.length})`,
      ``,
      row(["Email", "Name", "Role here", "Reason"]),
      row(["---", "---", "---", "---"]),
      ...skip.map(({ user, reason }) => row([user.email, user.full_name, user.role, reason])),
      ``,
    ].join("\n");
    writeFileSync(reportPath, md);
    console.log(`\nReport written to ${reportPath}`);
  }

  if (!apply) {
    console.log(`\nDry run — nothing written. Re-run with --apply to add ${grant.length} grant(s).`);
  } else if (grant.length) {
    await identity.query("BEGIN");
    let done = 0;
    for (const { user, identity: i } of grant) {
      const result = await identity.query(
        `INSERT INTO identity.app_grants (user_id, app_slug, status, app_role, decided_at, decided_note)
         VALUES ($1, $2, 'Approved', $3, now(), $4)
         ON CONFLICT (user_id, app_slug) DO NOTHING`,
        [i.id, APP_SLUG, user.role, NOTE]
      );
      done += result.rowCount;
    }
    await identity.query("COMMIT");
    console.log(`\nAdded ${done} grant(s). Next: npm run db:seed:identity`);
  } else {
    console.log(`\nNothing to grant.`);
  }
} catch (error) {
  await identity.query("ROLLBACK").catch(() => {});
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await ec.end().catch(() => {});
  await identity.end().catch(() => {});
}
