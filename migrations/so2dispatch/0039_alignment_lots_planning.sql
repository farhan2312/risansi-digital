-- 0039  Alignment lots follow Planning's lots: lot_no n is Planning's lot n,
-- 0 the SO as a whole (what was set before Planning had lots; a lot not set
-- yet takes it). The lots made by 0038 become lot 0. Same statements in
-- apps/so2dispatch/db/schema.sql. Idempotent and additive.

ALTER TABLE order_alignment_lots ADD COLUMN IF NOT EXISTS lot_no INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS order_alignment_lots_order_lot_uq ON order_alignment_lots (order_id, lot_no);
