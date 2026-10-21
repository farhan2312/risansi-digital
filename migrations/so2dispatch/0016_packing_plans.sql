-- 0016  Packing of a pump SO, planned like its assembly: the same entries
-- (order_assembly_plans) with stage 'packing', each also saying whether a
-- PDI is needed. Only what is assembled can be packed. An EC fully packed
-- takes its Actual Material Packing Date from its last packed entry, which is
-- what Dispatch reads. Existing entries are assembly ones.
-- Apply to ec_to_dispatch before deploying the code that reads it; also in
-- apps/so2dispatch/db/schema.sql. Idempotent and additive.
ALTER TABLE order_assembly_plans ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'assembly';
ALTER TABLE order_assembly_plans DROP CONSTRAINT IF EXISTS order_assembly_plans_stage_check;
ALTER TABLE order_assembly_plans ADD CONSTRAINT order_assembly_plans_stage_check CHECK (stage IN ('assembly', 'packing'));
ALTER TABLE order_assembly_plans ADD COLUMN IF NOT EXISTS pdi TEXT;
