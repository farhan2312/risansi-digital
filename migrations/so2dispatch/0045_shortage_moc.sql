-- 0045  A shortage's MOC: the material of the part short, after its quantity
-- (Planning, Pump and Spare ECs). Same statement in apps/so2dispatch/db/schema.sql.
-- Idempotent and additive.

ALTER TABLE order_part_shortages ADD COLUMN IF NOT EXISTS moc TEXT;
