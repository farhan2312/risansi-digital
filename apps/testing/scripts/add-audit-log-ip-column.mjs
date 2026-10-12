// Additive migration: ip_address on audit_logs -- best-effort client IP
// captured at the moment of each logged action (see getClientIp in
// audit.ts), shown as its own column on the Audit Log's Activity tab.
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
  const sql = `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address varchar(64)`;
  await client.query(sql);
  console.log("OK:", sql);
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
