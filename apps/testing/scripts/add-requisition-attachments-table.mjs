// Additive migration: requisition_attachments table, so the source team (or
// central-admin/admin) can attach PO copies / drawings / spec sheets to a
// requisition at intake, and the testing team can open them. Stored inline
// (bytea) -- see the comment on requisitionAttachments in schema.ts for why.
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
    CREATE TABLE IF NOT EXISTS requisition_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      requisition_id uuid NOT NULL REFERENCES test_requisitions(id) ON DELETE CASCADE,
      file_name varchar(255) NOT NULL,
      mime_type varchar(100) NOT NULL,
      file_size integer NOT NULL,
      file_data bytea NOT NULL,
      uploaded_by uuid,
      uploaded_by_name varchar(100),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await client.query(sql);
  console.log("OK: requisition_attachments table created (or already existed).");

  const idx = `CREATE INDEX IF NOT EXISTS requisition_attachments_requisition_id_idx
                 ON requisition_attachments (requisition_id)`;
  await client.query(idx);
  console.log("OK: index on requisition_id created (or already existed).");
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
