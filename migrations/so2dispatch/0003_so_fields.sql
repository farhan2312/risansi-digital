-- 0003  More of the Sales Order, and which EC an FR's complaint is about.
--
-- Apply to ec_to_dispatch BEFORE deploying the code that reads them: the
-- Orders and Order Making pages select these columns. The same statements are
-- in apps/so2dispatch/db/schema.sql (npm run db:migrate). Idempotent and
-- additive: the standalone ECtoDispatch portal on the same database is
-- unaffected.

-- An FR: the EC the complaint is against (the earlier supply it replaces).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS complaint_ec_no TEXT;

-- Under the Sales Order heading, typed as the SO gives them.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS file_no TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS taxable_value NUMERIC(14,2);
