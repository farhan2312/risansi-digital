-- 0025  A pump EC's attachment: the SharePoint link given on the Pump Add-On,
-- opened from Purchase, Planning, Assembly & Packing, Drawing, Quality and the
-- Orders page. The same statement is in apps/so2dispatch/db/schema.sql.
-- Idempotent and additive.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS ec_link TEXT;
