-- Provenance tag for bulk-imported historic visits, so an import batch can be
-- identified and rolled back (DELETE FROM visits WHERE import_source = '...').
-- NULL for visits created normally through the app.

ALTER TABLE visits ADD COLUMN IF NOT EXISTS import_source text;
CREATE INDEX IF NOT EXISTS idx_visits_import_source ON visits(import_source);
