// Additive migration: human-readable sequential requisition number, same
// pattern as pump_test_reports.report_no.
// 1. Create the sequence new inserts will pull from (POST /api/requisitions).
// 2. Add the (initially NULL) requisition_no column.
// 3. Backfill existing rows in created_at order, oldest = REQ-000001.
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
  await client.query(`CREATE SEQUENCE IF NOT EXISTS test_requisitions_requisition_no_seq`);
  console.log("OK: sequence created (or already existed)");

  await client.query(`ALTER TABLE test_requisitions ADD COLUMN IF NOT EXISTS requisition_no varchar(20)`);
  console.log("OK: requisition_no column added (or already existed)");

  const backfill = await client.query(`
    WITH ordered AS (
      SELECT id, row_number() OVER (ORDER BY created_at ASC) AS rn
      FROM test_requisitions
      WHERE requisition_no IS NULL
    )
    UPDATE test_requisitions r
    SET requisition_no = 'REQ-' || lpad(ordered.rn::text, 6, '0')
    FROM ordered
    WHERE r.id = ordered.id
  `);
  console.log(`OK: backfilled ${backfill.rowCount} existing requisition(s)`);

  const { rows } = await client.query(`SELECT count(*)::int AS n FROM test_requisitions WHERE requisition_no IS NOT NULL`);
  await client.query(`SELECT setval('test_requisitions_requisition_no_seq', $1, true)`, [rows[0].n]);
  console.log(`OK: sequence advanced to ${rows[0].n}`);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'test_requisitions_requisition_no_unique'
      ) THEN
        ALTER TABLE test_requisitions ADD CONSTRAINT test_requisitions_requisition_no_unique UNIQUE (requisition_no);
      END IF;
    END $$;
  `);
  console.log("OK: unique constraint on requisition_no ensured");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
