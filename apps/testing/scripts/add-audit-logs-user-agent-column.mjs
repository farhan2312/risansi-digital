// Additive migration: stores the browser's User-Agent on sign-in audit rows so
// the Audit Log's Devices / Browsers / OS cards have something to read.
// Nullable and un-backfilled on purpose -- rows logged before this point simply
// show up as "Unknown"; only sign-ins from now on carry a value.
import { Pool } from "pg";

const sslmode = process.env.DB_SSLMODE ?? "require";
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: sslmode === "disable" ? false : { rejectUnauthorized: false },
});

const client = await pool.connect();
try {
  await client.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent text`);
  console.log("OK: added audit_logs.user_agent");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
