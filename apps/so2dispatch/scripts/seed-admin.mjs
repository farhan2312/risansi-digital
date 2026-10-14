// Seeds (or updates) the single admin account from env vars.
// Usage: npm run db:seed:admin
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import bcrypt from "bcryptjs";

// Load .env.local (then .env) into process.env.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
      if (line.trim().startsWith("#")) continue;
      const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(match[1] in process.env)) process.env[match[1]] = value;
    }
  } catch {
    // file not present — ignore
  }
}

const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
const ADMIN_NAME = process.env.ADMIN_NAME || "Platform Admin";

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Fill in .env.local first.");
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env.local.");
  process.exit(1);
}

const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

try {
  await client.connect();
  // Upsert on the case-insensitive email index. On re-run, the admin's name /
  // password / role / status are refreshed to match the env values.
  const result = await client.query(
    `INSERT INTO users (full_name, email, password_hash, role, status)
     VALUES ($1, $2, $3, 'admin', 'approved')
     ON CONFLICT (lower(email)) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           password_hash = EXCLUDED.password_hash,
           role = 'admin',
           status = 'approved'
     RETURNING id, email, (xmax = 0) AS inserted`,
    [ADMIN_NAME, ADMIN_EMAIL, passwordHash]
  );
  const row = result.rows[0];
  console.log(
    `✔ Admin ${row.inserted ? "created" : "updated"}: ${row.email} (${row.id})`
  );
} catch (error) {
  console.error("✖ Admin seed failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
