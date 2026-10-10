-- Tag a relevant TSM on a visit's expansion opportunity (auto_source =
-- 'expansion_plan'). The tagged person — an in-system user or an external
-- name+email — is emailed once, on report submission. tsm_notified_at guards
-- against a repeat send if the report is re-submitted.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS tsm_user_id        integer;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS tsm_external       text;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS tsm_external_email text;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS tsm_notified_at    timestamptz;
