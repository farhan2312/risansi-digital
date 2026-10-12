// Additive migration: one row per "your bug report's status changed" notification, shown in the
// reporter's top-bar bell. Titles and names are snapshots (like submitted_by elsewhere) so a
// notification stays readable even if the bug report or the admin's account is later removed.
// No foreign keys on purpose: deleting a bug report or a user must never be blocked by old notifications.
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
  await client.query(`
    CREATE TABLE IF NOT EXISTS bug_report_notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      bug_report_id uuid,
      bug_title varchar(255) NOT NULL,
      old_status varchar(20),
      new_status varchar(20) NOT NULL,
      changed_by_name varchar(100),
      created_at timestamptz NOT NULL DEFAULT now(),
      read_at timestamptz
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS bug_report_notifications_user_idx ON bug_report_notifications (user_id, created_at DESC)`
  );
  console.log("OK: bug_report_notifications table + index ready");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
