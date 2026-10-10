-- Tie each monthly-revenue row to the upload that created it.
--
-- deleteUpload used to remove revenue by (month, uploaded_by) — so undoing one
-- upload wiped EVERY revenue row that uploader had ever entered for that month,
-- including rows from a different, still-wanted upload. (Confirmed live: a user
-- with two June uploads would lose both on either undo.) This column lets an
-- undo delete exactly the rows that upload wrote, nothing else.
--
-- ON DELETE SET NULL is a safety net only: the app deletes the revenue rows
-- explicitly by upload_id before removing the log, so a log delete never relies
-- on cascade. The 8,800 pre-existing rows keep upload_id NULL — they predate the
-- fix and cannot be mapped to a log after the fact, so those legacy uploads are
-- no longer row-level undoable (deliberately: better un-undoable than wiping the
-- wrong month's data).

ALTER TABLE client_revenue_monthly
  ADD COLUMN IF NOT EXISTS upload_id integer REFERENCES revenue_upload_log(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_revenue_upload
  ON client_revenue_monthly (upload_id) WHERE upload_id IS NOT NULL;
