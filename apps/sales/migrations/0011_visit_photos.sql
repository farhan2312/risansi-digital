-- 0011  Visit photos — switch storage from external URL to in-DB bytea.
--
-- A legacy visit_photos table already exists (storage_url-based, 0 rows, never
-- wired into the app). Per the requirement to keep photos IN the database we
-- repurpose it to hold the image bytes directly. Existing useful columns
-- (id, visit_id, caption, uploaded_at, lat, lng) are kept; lat/lng remain
-- available for optional geotagging of field photos.
--
-- Images are compressed client-side (~1600px JPEG, q≈0.82) before upload, so a
-- typical row is ~100–300 KB. The caption column holds only the rep's free-text
-- addition; the fixed prefix shown in the UI ("Visit #<id> · <date, time>") is
-- derived from visit_id + uploaded_at and is never stored, so it can't drift.

ALTER TABLE visit_photos ADD COLUMN IF NOT EXISTS image_bytes bytea;
ALTER TABLE visit_photos ADD COLUMN IF NOT EXISTS mime_type   text NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE visit_photos ADD COLUMN IF NOT EXISTS byte_size   integer;
ALTER TABLE visit_photos ADD COLUMN IF NOT EXISTS uploaded_by text;

-- The table is empty, so image_bytes can be tightened to NOT NULL safely.
ALTER TABLE visit_photos ALTER COLUMN image_bytes SET NOT NULL;

-- storage_url was NOT NULL for the abandoned external blob store; no longer set.
ALTER TABLE visit_photos ALTER COLUMN storage_url DROP NOT NULL;

-- uploaded_at is our capture/upload timestamp; caption defaults to empty.
ALTER TABLE visit_photos ALTER COLUMN uploaded_at SET DEFAULT now();
ALTER TABLE visit_photos ALTER COLUMN caption     SET DEFAULT '';

-- Cap stored image size (~15 MB) to match the client-side compression budget.
ALTER TABLE visit_photos
  ADD CONSTRAINT visit_photos_size_chk CHECK (octet_length(image_bytes) <= 15000000);

CREATE INDEX IF NOT EXISTS idx_visit_photos_visit ON visit_photos(visit_id, uploaded_at);
