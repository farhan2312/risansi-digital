// Additive-only migration for the "Viscosity Correction Chart" report format.
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

const statements = [
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS report_format varchar(30)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS po_no varchar(100)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS ec_no varchar(100)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS rev_no varchar(20)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS rev_date date`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS pump_serial_no varchar(100)`,
  `ALTER TABLE pump_test_report_points ADD COLUMN IF NOT EXISTS volumetric_efficiency_liquid numeric(10,6)`,
  `ALTER TABLE pump_test_report_points ADD COLUMN IF NOT EXISTS mechanical_efficiency_liquid numeric(10,6)`,
  // Backfill existing rows so the new column is explicit rather than ambiguous.
  `UPDATE pump_test_reports SET report_format = 'observation' WHERE report_format IS NULL`,
];

const client = await pool.connect();
try {
  for (const sql of statements) {
    await client.query(sql);
    console.log("OK:", sql);
  }
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
