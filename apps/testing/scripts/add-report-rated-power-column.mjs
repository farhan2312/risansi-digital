// Additive migration: rated_power_kw on pump_test_reports, autofilled from
// the linked requisition's Power (HP/KW) so a report can flag on its own
// (without a separate fetch) whether testing actually reached it.
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
  const sql = `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS rated_power_kw numeric(10,4)`;
  await client.query(sql);
  console.log("OK:", sql);
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
