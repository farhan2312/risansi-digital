-- 0018  The packing plan history also keeps a pump lot's assembly plan:
-- each change to a lot's assembly day or shift, marked stage 'assembly'.
-- Existing rows are packing. Apply to ec_to_dispatch before deploying the
-- code that reads it; also in apps/so2dispatch/db/schema.sql. Idempotent and
-- additive.
ALTER TABLE order_packing_plan_history ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'packing';
