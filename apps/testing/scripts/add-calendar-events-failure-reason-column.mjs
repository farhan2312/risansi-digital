// Additive migration: failure_reason on calendar_events -- why a planned test failed. Required (by the
// API, not the DB) whenever an event's status is "Failed"; cleared when the status moves off Failed.
// Nullable, no default, so every existing row stays exactly as it is.
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
  await client.query("BEGIN");
  const sql = `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS failure_reason text`;
  await client.query(sql);
  const { rows } = await client.query(
    `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'calendar_events' AND column_name = 'failure_reason'`
  );
  if (rows.length !== 1 || rows[0].data_type !== "text" || rows[0].is_nullable !== "YES") {
    throw new Error("Verification failed: " + JSON.stringify(rows));
  }
  await client.query("COMMIT");
  console.log("OK:", sql);
} catch (e) {
  await client.query("ROLLBACK");
  console.error("Rolled back:", e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
