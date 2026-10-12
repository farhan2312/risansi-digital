// One-off, hand-written migration (not drizzle-kit — see drizzle.config.ts
// comments for why `push`/`generate` are unsafe against this shared DB).
// Purely additive: ADD COLUMN IF NOT EXISTS, nothing dropped or altered.
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
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS test_type varchar(20)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS npsha_status varchar(20)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS capacity_unit varchar(20)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS head_unit varchar(20)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS reference_voltage numeric(10,2)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS reference_current numeric(10,2)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS vnotch_baseline numeric(10,2)`,
  `ALTER TABLE pump_test_report_points ADD COLUMN IF NOT EXISTS height_taken_for_filling numeric(10,2)`,
  `ALTER TABLE pump_test_report_points ADD COLUMN IF NOT EXISTS time_taken_to_fill_bucket_sec numeric(10,2)`,
  `ALTER TABLE pump_test_report_points ADD COLUMN IF NOT EXISTS volumetric_efficiency numeric(10,6)`,
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
