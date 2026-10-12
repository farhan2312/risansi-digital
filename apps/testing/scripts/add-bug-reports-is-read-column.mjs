// Additive migration: backs the sidebar notification bell's unread bug-report
// count. Existing reports (as of this migration) are backfilled to true
// (read) so shipping this doesn't suddenly flag ~everything already in the
// table as a fresh unread notification -- only reports created after this
// point default to false (unread) and count toward the bell.
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
  await client.query(`ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false`);
  console.log("OK: added is_read column");

  const result = await client.query(`UPDATE bug_reports SET is_read = true WHERE is_read = false`);
  console.log(`OK: backfilled ${result.rowCount} existing report(s) to read`);
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
