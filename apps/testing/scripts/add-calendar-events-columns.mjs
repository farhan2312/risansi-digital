// Additive migration: adds ec_quotation_no, responsible_person and status to the existing
// calendar_events table (see calendarEvents in schema.ts). Safe to re-run.
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
  await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS ec_quotation_no varchar(100)`);
  console.log("OK: ec_quotation_no");
  await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS responsible_person varchar(100)`);
  console.log("OK: responsible_person");
  await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'Planned'`);
  console.log("OK: status");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
