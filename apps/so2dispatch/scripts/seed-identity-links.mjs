// Links each SO to Dispatch account to its Risansi Digital identity
// (users.identity_user_id) — the seed for Phase 5 of the shared login.
//
// Usage:
//   npm run db:seed:identity                      dry run: shows what would happen, writes nothing
//   npm run db:seed:identity -- --report FILE.md  dry run, plus the full list as Markdown
//   npm run db:seed:identity -- --apply           writes the links
//
// Matches on lower(email). Links an account only when ALL of these hold:
//   - an identity with that email exists and is active
//   - it holds an Approved grant on `so2dispatch` with a role this portal knows
//   - the account here is not linked yet, and no other account here holds that identity
//
// Why only Approved grants: once linked, the grant decides whether somebody
// may open this portal — even through the local password (step 4). Linking
// anybody without one would lock them out. Everyone else is left alone and
// listed with the reason, so running it again after grants are added picks
// them up. Running it twice changes nothing the second time.
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
// Keep in step with ROLE_LABELS in lib/roles.ts.
const ROLES = [
  "admin", "central_visibility", "operations", "accounts", "drawing", "planning",
  "purchase", "qc", "assembly", "dispatch", "order_making", "order_making_so", "rep",
];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
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
    `SELECT u.id, lower(u.email) AS email, u.is_active, g.status, g.app_role
       FROM identity.users u
       LEFT JOIN identity.app_grants g ON g.user_id = u.id AND g.app_slug = $1`,
    [APP_SLUG]
  );
  const byEmail = new Map(identities.map((r) => [r.email, r]));

  const { rows: users } = await ec.query(
    `SELECT id, full_name, email, role, status, identity_user_id FROM users ORDER BY lower(email)`
  );
  const linkedIds = new Set(users.filter((u) => u.identity_user_id).map((u) => u.identity_user_id));
  const localEmails = new Set(users.map((u) => u.email.toLowerCase()));

  const link = [];   // { user, identity }
  const skip = [];   // { user, reason, identity? }
  for (const user of users) {
    const found = byEmail.get(user.email.toLowerCase());
    if (user.identity_user_id) {
      skip.push({ user, reason: "already linked" });
    } else if (!found) {
      skip.push({ user, reason: "no identity with this email" });
    } else if (!found.is_active) {
      skip.push({ user, identity: found, reason: "identity is inactive" });
    } else if (found.status !== "Approved") {
      skip.push({ user, identity: found, reason: found.status ? `grant is ${found.status}` : "no grant" });
    } else if (!ROLES.includes(found.app_role)) {
      skip.push({ user, identity: found, reason: `grant role "${found.app_role}" is not a role here` });
    } else if (linkedIds.has(found.id)) {
      skip.push({ user, identity: found, reason: "identity already linked to another account" });
    } else {
      link.push({ user, identity: found });
    }
  }

  // Approved here with no local account: step 5 creates theirs on first visit.
  const willBeCreated = identities.filter(
    (r) => r.status === "Approved" && r.is_active && !localEmails.has(r.email)
  );

  const pad = (s, n) => String(s ?? "").padEnd(n);
  console.log(`Accounts here: ${users.length}   Identities: ${identities.length}\n`);
  console.log(`WILL LINK (${link.length})`);
  for (const { user, identity: i } of link) {
    const note = i.app_role !== user.role ? `  role changes ${user.role} -> ${i.app_role}` : "";
    console.log(`  ${pad(user.email, 38)} ${pad(i.app_role, 18)}${note}`);
  }
  console.log(`\nLEFT UNLINKED (${skip.length})`);
  for (const { user, reason } of skip) {
    console.log(`  ${pad(user.email, 38)} ${pad(user.role, 18)} ${reason}`);
  }
  console.log(`\nAPPROVED AT THE HUB, NO ACCOUNT HERE — created on first visit (${willBeCreated.length})`);
  for (const r of willBeCreated) console.log(`  ${pad(r.email, 38)} ${r.app_role}`);

  if (reportPath) {
    const row = (cells) => `| ${cells.join(" | ")} |`;
    const md = [
      `# SO to Dispatch — identity links`,
      ``,
      `Generated ${new Date().toISOString().slice(0, 10)} by \`npm run db:seed:identity\` (dry run).`,
      `An account is linked only when its identity is active and holds an Approved \`${APP_SLUG}\` grant with a role this portal knows.`,
      ``,
      `## Will link (${link.length})`,
      ``,
      row(["Email", "Name", "Role here", "Grant role"]),
      row(["---", "---", "---", "---"]),
      ...link.map(({ user, identity: i }) => row([user.email, user.full_name, user.role, i.app_role])),
      ``,
      `## Left unlinked (${skip.length})`,
      ``,
      `No identity: Farhan creates one at the hub, or it stays unlinked on purpose (shared or test account) and stops working when the local login is retired.`,
      ``,
      row(["Email", "Name", "Role here", "Reason"]),
      row(["---", "---", "---", "---"]),
      ...skip.map(({ user, reason }) => row([user.email, user.full_name, user.role, reason])),
      ``,
      `## Approved at the hub, no account here (${willBeCreated.length})`,
      ``,
      `Created on their first visit (Phase 5 step 5).`,
      ``,
      row(["Email", "Grant role"]),
      row(["---", "---"]),
      ...willBeCreated.map((r) => row([r.email, r.app_role])),
      ``,
    ].join("\n");
    writeFileSync(reportPath, md);
    console.log(`\nReport written to ${reportPath}`);
  }

  if (!apply) {
    console.log(`\nDry run — nothing written. Re-run with --apply to link ${link.length} account(s).`);
  } else if (link.length) {
    await ec.query("BEGIN");
    let done = 0;
    for (const { user, identity: i } of link) {
      const result = await ec.query(
        `UPDATE users SET identity_user_id = $1, updated_at = now()
          WHERE id = $2 AND identity_user_id IS NULL`,
        [i.id, user.id]
      );
      done += result.rowCount;
    }
    await ec.query("COMMIT");
    console.log(`\nLinked ${done} account(s).`);
  } else {
    console.log(`\nNothing to link.`);
  }
} catch (error) {
  await ec.query("ROLLBACK").catch(() => {});
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await ec.end().catch(() => {});
  await identity.end().catch(() => {});
}
