-- 0034  Assembly & Packing says Yes or No for an SO's base plate and wooden box:
-- set only when it differs from what the ECs and the Packing Requirement say.
-- And a pump lot's final alignment, Yes or No, from the lot form's packing. The
-- same statements are in apps/so2dispatch/db/schema.sql. Idempotent and additive.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS base_plate_override TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wooden_box_override TEXT;
ALTER TABLE order_ready_lots ADD COLUMN IF NOT EXISTS final_alignment TEXT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_base_plate_override_check;
ALTER TABLE orders ADD CONSTRAINT orders_base_plate_override_check CHECK (base_plate_override IS NULL OR base_plate_override IN ('Yes', 'No'));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_wooden_box_override_check;
ALTER TABLE orders ADD CONSTRAINT orders_wooden_box_override_check CHECK (wooden_box_override IS NULL OR wooden_box_override IN ('Yes', 'No'));
ALTER TABLE order_ready_lots DROP CONSTRAINT IF EXISTS order_ready_lots_final_alignment_check;
ALTER TABLE order_ready_lots ADD CONSTRAINT order_ready_lots_final_alignment_check CHECK (final_alignment IS NULL OR final_alignment IN ('Yes', 'No'));
