// Additive migration: specific_gravity on test_requisitions, so the Req.
// Capacity / Head unit-conversion hints can account for the actual liquid
// instead of assuming water.
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
  const sql = `ALTER TABLE test_requisitions ADD COLUMN IF NOT EXISTS specific_gravity numeric(6,3)`;
  await client.query(sql);
  console.log("OK:", sql);
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
