// Additive migration: human-readable sequential report number.
// 1. Create the sequence new inserts will pull from (POST /api/reports).
// 2. Add the (initially NULL) report_no column.
// 3. Backfill existing rows in created_at order, oldest = TR-000001.
// 4. Advance the sequence past the backfilled range so new inserts continue on.
// 5. Enforce uniqueness once every row has a value.
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
  await client.query(`CREATE SEQUENCE IF NOT EXISTS pump_test_reports_report_no_seq`);
  console.log("OK: sequence created (or already existed)");

  await client.query(`ALTER TABLE pump_test_reports ADD COLUMN IF NOT EXISTS report_no varchar(20)`);
  console.log("OK: report_no column added (or already existed)");

  const backfill = await client.query(`
    WITH ordered AS (
      SELECT id, row_number() OVER (ORDER BY created_at ASC) AS rn
      FROM pump_test_reports
      WHERE report_no IS NULL
    )
    UPDATE pump_test_reports r
    SET report_no = 'TR-' || lpad(ordered.rn::text, 6, '0')
    FROM ordered
    WHERE r.id = ordered.id
  `);
  console.log(`OK: backfilled ${backfill.rowCount} existing report(s)`);

  const { rows } = await client.query(`SELECT count(*)::int AS n FROM pump_test_reports WHERE report_no IS NOT NULL`);
  await client.query(`SELECT setval('pump_test_reports_report_no_seq', $1, true)`, [rows[0].n]);
  console.log(`OK: sequence advanced to ${rows[0].n}`);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pump_test_reports_report_no_unique'
      ) THEN
        ALTER TABLE pump_test_reports ADD CONSTRAINT pump_test_reports_report_no_unique UNIQUE (report_no);
      END IF;
    END $$;
  `);
  console.log("OK: unique constraint on report_no ensured");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
