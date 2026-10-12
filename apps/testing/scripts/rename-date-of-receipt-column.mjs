// Migration: test_requisitions.date_of_receipt -> date_of_requisition, to
// match the field's user-facing label ("Date of Requisition"). Idempotent --
// skips if the rename already happened. This is a breaking rename rather
// than an additive change, so the app code that reads it must ship at the
// same time.
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
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'test_requisitions'
        AND column_name IN ('date_of_receipt', 'date_of_requisition')`
  );
  const existing = rows.map((r) => r.column_name);

  if (existing.includes("date_of_requisition")) {
    console.log("Already renamed: date_of_requisition exists, nothing to do.");
  } else if (existing.includes("date_of_receipt")) {
    const sql = `ALTER TABLE test_requisitions RENAME COLUMN date_of_receipt TO date_of_requisition`;
    await client.query(sql);
    console.log("OK:", sql);
  } else {
    throw new Error("Neither date_of_receipt nor date_of_requisition found on test_requisitions");
  }

  const check = await client.query(
    `SELECT count(*)::int AS total, count(date_of_requisition)::int AS with_date
       FROM test_requisitions`
  );
  console.log("Rows:", check.rows[0]);
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
