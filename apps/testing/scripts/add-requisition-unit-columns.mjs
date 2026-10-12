// Additive migration: unit columns for the requisition's Req. Capacity and
// Head fields, so the value entered can be tagged with whichever unit it was
// measured in (the form shows a live conversion to the base unit alongside).
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
    `ALTER TABLE test_requisitions ADD COLUMN IF NOT EXISTS req_capacity_unit varchar(20)`,
    `ALTER TABLE test_requisitions ADD COLUMN IF NOT EXISTS head_unit varchar(20)`,
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
