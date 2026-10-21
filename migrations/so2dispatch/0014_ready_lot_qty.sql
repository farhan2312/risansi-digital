-- 0014  A pump SO's readiness lot names the ECs in it and how many of each.
-- Each EC's lot row keeps its own quantity in that lot; the EC's Ready Qty is
-- the sum over its lots. NULL on a Spare's lots and on lots from before.
-- Apply to ec_to_dispatch before deploying the code that reads it; also in
-- apps/so2dispatch/db/schema.sql. Idempotent and additive.
ALTER TABLE order_ready_lots ADD COLUMN IF NOT EXISTS qty INT CHECK (qty IS NULL OR qty >= 0);
