// Additive migration: forces a password change on first login for accounts
// created from here on. Existing accounts (as of this migration) are
// backfilled to false so nobody currently active gets locked out --  only
// accounts created after this point default to true.
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
  await client.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true`
  );
  console.log("OK: added must_change_password column");

  const result = await client.query(`UPDATE users SET must_change_password = false`);
  console.log(`OK: backfilled ${result.rowCount} existing account(s) to false`);
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
