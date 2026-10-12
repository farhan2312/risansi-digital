// Additive migration: lets a calendar event point at a requisition (by its REQ-000123 number), so marking
// the event Completed can require that requisition's test report to be filed first.
// Plain text on purpose (like test_requisitions.requisition_no) -- no foreign key, nothing to block deletes.
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
  await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS requisition_no varchar(20)`);
  console.log("OK: calendar_events.requisition_no ready");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
