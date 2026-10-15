-- 0006  A pump's name plate, captured on the Pump Add-On (EC form).
--
-- Apply to ec_to_dispatch BEFORE deploying the code that reads them; the same
-- statements are in apps/so2dispatch/db/schema.sql. Idempotent and additive.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS capacity NUMERIC(14,3);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS capacity_unit TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS head NUMERIC(14,3);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS head_unit TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS drive_motor_rating NUMERIC(14,3);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS drive_motor_rating_unit TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS drive_motor_speed NUMERIC(10,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS pump_speed NUMERIC(10,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS liquid TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tag_no TEXT;
