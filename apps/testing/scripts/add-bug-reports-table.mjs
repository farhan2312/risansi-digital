// Additive migration: bug_reports table for the "Report a Bug" widget,
// available to every logged-in user regardless of role. Screenshot stored
// inline (bytea), same pattern as requisition_attachments -- see the
// comment on bugReports in schema.ts.
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
  const sql = `
    CREATE TABLE IF NOT EXISTS bug_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type varchar(20) DEFAULT 'bug',
      title varchar(255) NOT NULL,
      description text,
      severity varchar(20) DEFAULT 'Medium',
      page varchar(255),
      status varchar(20) DEFAULT 'Open',
      screenshot_file_name varchar(255),
      screenshot_mime_type varchar(100),
      screenshot_file_size integer,
      screenshot_data bytea,
      reported_by uuid,
      reported_by_name varchar(100),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await client.query(sql);
  console.log("OK: bug_reports table created (or already existed).");

  const idx = `CREATE INDEX IF NOT EXISTS bug_reports_status_idx ON bug_reports (status)`;
  await client.query(idx);
  console.log("OK: index on status created (or already existed).");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
