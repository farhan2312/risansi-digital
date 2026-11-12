-- 0037  SO versions start at v0: a new SO is v0, its first new version v1.
-- SOs with no version made yet move from 1 to 0. Same statements in
-- apps/so2dispatch/db/schema.sql. Idempotent.

ALTER TABLE orders ALTER COLUMN version_no SET DEFAULT 0;

UPDATE orders o
   SET version_no = 0
 WHERE o.version_no = 1
   AND NOT EXISTS (SELECT 1 FROM order_versions v WHERE v.order_id = o.id);
