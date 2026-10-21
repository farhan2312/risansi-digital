-- 0019  A readiness lot can be In plan — planned for a date, not ready yet —
-- as well as Partial or Fully ready. Apply to ec_to_dispatch before deploying
-- the code that writes it; also in apps/so2dispatch/db/schema.sql.
-- Idempotent.
ALTER TABLE order_ready_lots DROP CONSTRAINT IF EXISTS order_ready_lots_status_check;
ALTER TABLE order_ready_lots ADD CONSTRAINT order_ready_lots_status_check
    CHECK (status IS NULL OR status IN ('In plan', 'Partial ready', 'Fully ready'));
