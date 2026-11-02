-- 0029  A pump lot's packing status, chosen by Assembly & Packing, and its
-- remarks: a lot takes a packing slip once it has a status. Lots already packed
-- read Packed. The same statements are in apps/so2dispatch/db/schema.sql.
-- Idempotent and additive.

ALTER TABLE order_ready_lots ADD COLUMN IF NOT EXISTS pump_packing_status TEXT;
ALTER TABLE order_ready_lots ADD COLUMN IF NOT EXISTS packing_remarks TEXT;
ALTER TABLE order_ready_lots DROP CONSTRAINT IF EXISTS order_ready_lots_pump_packing_status_check;
ALTER TABLE order_ready_lots ADD CONSTRAINT order_ready_lots_pump_packing_status_check
    CHECK (pump_packing_status IS NULL OR pump_packing_status IN ('Packed', 'Actual Packing Pending'));
UPDATE order_ready_lots rl SET pump_packing_status = 'Packed'
  FROM order_items it
 WHERE it.id = rl.item_id AND it.item_type IN ('Pump', 'ROLB')
   AND rl.packed_date IS NOT NULL AND rl.pump_packing_status IS NULL;
