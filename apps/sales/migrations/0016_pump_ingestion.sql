-- Monthly Pump Ingestion: admins upload newly installed pumps per client from
-- Excel, just like Revenue Upload. Reuses the existing client_pumps table
-- (migration 0014); uploaded rows are tagged source='upload' and grouped by
-- upload_id so a whole upload can be undone. Idempotent + non-destructive.

-- Audit + grouping columns on client_pumps.
ALTER TABLE client_pumps
  ADD COLUMN IF NOT EXISTS upload_id  integer,
  ADD COLUMN IF NOT EXISTS entered_by text,
  ADD COLUMN IF NOT EXISTS entered_at timestamptz;

-- Idempotent re-uploads: a physical pump is keyed by its serial (SR No). The
-- index is PARTIAL so it only governs uploaded rows that carry a real serial —
-- the one-time historical 'import' rows and serial-less uploads are untouched
-- (those simply append). Safe to create: no 'upload' rows exist yet.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_pumps_upload_serial
  ON client_pumps (client_id, pump_sl_no)
  WHERE source = 'upload' AND pump_sl_no IS NOT NULL AND pump_sl_no <> '';

CREATE INDEX IF NOT EXISTS idx_client_pumps_upload ON client_pumps(upload_id);

-- Upload audit log (mirrors revenue_upload_log; pumps aren't month-keyed).
CREATE TABLE IF NOT EXISTS pump_upload_log (
  id            serial PRIMARY KEY,
  uploaded_by   text,
  filename      text,
  rows_total    integer NOT NULL DEFAULT 0,
  rows_inserted integer NOT NULL DEFAULT 0,
  rows_updated  integer NOT NULL DEFAULT 0,
  rows_skipped  integer NOT NULL DEFAULT 0,
  skipped_codes text[],
  status        text NOT NULL DEFAULT 'processing',
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
