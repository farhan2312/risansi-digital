// Additive migration: offer date on requisitions, alongside EC/Quotation/Offer No.
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
  const sql = `ALTER TABLE test_requisitions ADD COLUMN IF NOT EXISTS offer_date date`;
  await client.query(sql);
  console.log("OK:", sql);
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
