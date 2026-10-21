-- 0017  A pump SO is assembled and packed lot by lot, following Planning's
-- readiness lots: each lot gets an assembly day and shift and the day it was
-- assembled (on every EC's row of that lot, as its packing columns already
-- are). Packing uses the lot's existing packing_plan_date / packing_shift /
-- pdi / packed_date. The free EC-by-EC entries of order_assembly_plans
-- (0015, 0016) are no longer used.
-- Apply to ec_to_dispatch before deploying the code that reads it; also in
-- apps/so2dispatch/db/schema.sql. Idempotent and additive.
ALTER TABLE order_ready_lots ADD COLUMN IF NOT EXISTS assembly_plan_date DATE;
ALTER TABLE order_ready_lots ADD COLUMN IF NOT EXISTS assembly_shift TEXT;
ALTER TABLE order_ready_lots ADD COLUMN IF NOT EXISTS assembled_date DATE;
