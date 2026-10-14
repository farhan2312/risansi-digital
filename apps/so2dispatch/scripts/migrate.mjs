// Applies db/schema.sql to the database in DATABASE_URL.
// Usage: npm run db:migrate
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Load .env.local (then .env) so DATABASE_URL is available when run via `node`.
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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill in your Azure PostgreSQL credentials."
  );
  process.exit(1);
}

const schema = readFileSync(join(root, "db", "schema.sql"), "utf8");
const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: true },
});

try {
  await client.connect();
  await client.query(schema);
  console.log("✔ Schema applied successfully.");
} catch (error) {
  console.error("✖ Migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
