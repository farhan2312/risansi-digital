-- 0033  A pump lot's assembly pending remarks: why it is not all assembled yet,
-- from Assembly & Packing's lot form. The same statement is in
-- apps/so2dispatch/db/schema.sql. Idempotent and additive.

ALTER TABLE order_ready_lots ADD COLUMN IF NOT EXISTS assembly_remarks TEXT;
