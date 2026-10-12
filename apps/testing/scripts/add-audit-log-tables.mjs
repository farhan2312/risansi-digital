// Additive migration: audit_logs, user_sessions, page_views -- the "Audit
// Log" admin page. See the comments on these tables in schema.ts.
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
    CREATE TABLE IF NOT EXISTS audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid,
      user_name varchar(100),
      user_email varchar(255),
      event_type varchar(30) NOT NULL,
      entity_type varchar(30),
      entity_id uuid,
      entity_label varchar(255),
      details text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  console.log("OK: audit_logs table created (or already existed).");

  await client.query(`CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at)`);
  await client.query(`CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs (user_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS audit_logs_event_type_idx ON audit_logs (event_type)`);
  console.log("OK: audit_logs indexes created (or already existed).");

  await client.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      user_name varchar(100),
      user_email varchar(255),
      login_at timestamptz NOT NULL DEFAULT now(),
      logout_at timestamptz,
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      page_view_count integer DEFAULT 0
    )
  `);
  console.log("OK: user_sessions table created (or already existed).");

  await client.query(`CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS user_sessions_login_at_idx ON user_sessions (login_at)`);
  console.log("OK: user_sessions indexes created (or already existed).");

  await client.query(`
    CREATE TABLE IF NOT EXISTS page_views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
      user_id uuid NOT NULL,
      path varchar(255) NOT NULL,
      viewed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  console.log("OK: page_views table created (or already existed).");

  await client.query(`CREATE INDEX IF NOT EXISTS page_views_session_id_idx ON page_views (session_id)`);
  console.log("OK: page_views index created (or already existed).");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
