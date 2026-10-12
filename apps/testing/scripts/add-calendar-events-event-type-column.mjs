// Additive migration: what kind of event this is. 'Test' (the default) must be linked to a requisition
// and needs that requisition's report before it can be Completed; 'Meeting' / 'Calibration' are not tests
// and complete freely. Existing events become 'Test' (the column default).
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
  await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS event_type varchar(20) NOT NULL DEFAULT 'Test'`);
  console.log("OK: calendar_events.event_type ready");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
