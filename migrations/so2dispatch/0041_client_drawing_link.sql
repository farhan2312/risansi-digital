-- 0041  The client's own drawing documents for an SO: SharePoint link(s), one
-- per line, in Terms & Conditions (not required). Drawing sees them on the SO.
-- Same statements in apps/so2dispatch/db/schema.sql. Idempotent and additive.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_drawing_link TEXT;
