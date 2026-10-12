// Additive migration: calendar_events table -- the Testing Calendar in the sidebar. Everyone signed
// in can view it; only the Testing role can create/update/delete an event (enforced in the API
// routes). See the comment on calendarEvents in schema.ts.
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
    CREATE TABLE IF NOT EXISTS calendar_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title varchar(200) NOT NULL,
      model varchar(100),
      event_date date NOT NULL,
      start_time varchar(20),
      end_time varchar(20),
      notes text,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_by_name varchar(100) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await client.query(sql);
  console.log("OK: calendar_events table created (or already existed).");

  const idx = `CREATE INDEX IF NOT EXISTS calendar_events_event_date_idx ON calendar_events (event_date)`;
  await client.query(idx);
  console.log("OK: index on event_date created (or already existed).");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
