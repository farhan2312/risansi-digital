-- 0011  A GAD issued to Planning carries its SharePoint link, which Planning
-- sees under the EC. Apply to ec_to_dispatch before deploying the code that
-- reads it; also in apps/so2dispatch/db/schema.sql. Idempotent and additive.
ALTER TABLE order_drawing_revisions ADD COLUMN IF NOT EXISTS planning_link TEXT;
