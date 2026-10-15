-- 0005  Order Making's own Clear / Hold, the first step.
--
-- Held by Order Making, an SO goes to no department (queues, dashboards,
-- reminders, notifications) until Order Making clears it. Apply to
-- ec_to_dispatch BEFORE deploying the code that reads them; the same
-- statements are in apps/so2dispatch/db/schema.sql. Idempotent and additive.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS om_status TEXT;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_om_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_om_status_check
    CHECK (om_status IS NULL OR om_status IN ('Clear', 'Hold'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS om_hold_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS om_hold_remarks TEXT;
