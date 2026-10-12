// Additive-only migration: vibration test + run summary footer block,
// Observation Sheet only (NEW PUMP TESTING FORMATE FOR DIGITAL, sheet 1).
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
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS vibration_sound_db numeric(6,2)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS vibration_x_mm_sec numeric(6,2)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS vibration_y_mm_sec numeric(6,2)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS vibration_z_mm_sec numeric(6,2)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS pump_started_at varchar(20)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS pump_stopped_at varchar(20)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS total_run varchar(20)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS ambient_temp_c numeric(6,2)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS max_bearing_temp_c numeric(6,2)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS total_rise_c numeric(6,2)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS witness varchar(100)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS inspector varchar(100)`,
  `ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS recorder varchar(100)`,
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
