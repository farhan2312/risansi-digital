// Additive migration: action_registry table -- one row per "Assign Retest",
// recording which rated fields the report missed (with a rated/measured
// snapshot), the assigning admin's action points, and who's who. See the
// comment on actionRegistry in schema.ts.
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
    CREATE TABLE IF NOT EXISTS action_registry (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      requisition_id uuid NOT NULL,
      report_id uuid NOT NULL,
      model varchar(100) NOT NULL,
      report_no varchar(20),
      unmet_fields varchar(100) NOT NULL,
      rated_head numeric(10, 2),
      measured_head numeric(10, 2),
      rated_capacity numeric(10, 4),
      measured_capacity numeric(10, 4),
      rated_power_kw numeric(10, 4),
      measured_power_kw numeric(10, 6),
      action_points text,
      assigned_by uuid,
      assigned_by_name varchar(100),
      originally_raised_by varchar(100),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await client.query(sql);
  console.log("OK: action_registry table created (or already existed).");

  const idx = `CREATE INDEX IF NOT EXISTS action_registry_created_at_idx ON action_registry (created_at DESC)`;
  await client.query(idx);
  console.log("OK: index on created_at created (or already existed).");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
