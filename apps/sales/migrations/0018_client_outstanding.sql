-- Monthly outstanding (accounts-receivable) snapshot.
--
-- The whole dataset is REPLACED on every upload (each monthly sheet fully
-- supersedes the last). The per-client amount reuses clients.total_outstanding
-- (already shown in Client 360 / the print sheet); this migration adds the
-- snapshot's as-of date, the mapped owner (resolved from the sheet's DEBTOR
-- code), and the raw debtor code for audit. A log table records each upload.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS outstanding_as_of       date,
  ADD COLUMN IF NOT EXISTS outstanding_owner_id    integer,
  ADD COLUMN IF NOT EXISTS outstanding_debtor_code varchar(12);

CREATE TABLE IF NOT EXISTS outstanding_upload_log (
  id            serial PRIMARY KEY,
  uploaded_by   varchar(255),
  filename      varchar(255),
  as_of_date    date,
  rows_total    integer NOT NULL DEFAULT 0,
  rows_matched  integer NOT NULL DEFAULT 0,
  rows_skipped  integer NOT NULL DEFAULT 0,
  skipped_codes text[],
  grand_total   numeric,
  status        varchar(20),
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
