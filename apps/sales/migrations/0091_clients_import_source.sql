-- Where a client record came from, when it came from a bulk load.
--
-- visits has carried this since the July visit-history import, so that load can
-- be undone in one statement. The October load creates clients as well as
-- visits — accounts the portal was missing, under the ERP codes the sheet gives
-- them — and those need the same escape hatch.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS import_source text;

COMMENT ON COLUMN clients.import_source IS
  'The bulk load that created this client, e.g. visit-history-2026-10. NULL for a client somebody entered.';

CREATE INDEX IF NOT EXISTS clients_import_source_idx ON clients (import_source) WHERE import_source IS NOT NULL;
