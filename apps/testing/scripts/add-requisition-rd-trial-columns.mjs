// Additive migration: media_type and target_date on test_requisitions, for
// the "Open Remarks / Media Type / Target Date" section shown on the
// requisition form only when Category is "Against R&D Trials". Open Remarks
// itself reuses the already-existing (previously unused by any form)
// general_remarks column -- no migration needed for that one.
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
  const statements = [
    `ALTER TABLE test_requisitions ADD COLUMN IF NOT EXISTS media_type varchar(100)`,
    `ALTER TABLE test_requisitions ADD COLUMN IF NOT EXISTS target_date date`,
  ];
  for (const sql of statements) {
    await client.query(sql);
    console.log("OK:", sql);
  }
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
