-- 0007  How many of a pump EC's pumps are ready: Planning, per EC, with its
-- Actual Pump Status. Apply to ec_to_dispatch before deploying the code that
-- reads it; also in apps/so2dispatch/db/schema.sql. Idempotent and additive.
ALTER TABLE order_planning ADD COLUMN IF NOT EXISTS ready_qty INT;
