-- 0024  Quality can say why an Open SO is still pending with it (remarks only).
-- The same statements are in apps/so2dispatch/db/schema.sql. Idempotent and
-- additive: every department allowed before still is.

ALTER TABLE order_pendency DROP CONSTRAINT IF EXISTS order_pendency_dept_check;
ALTER TABLE order_pendency ADD  CONSTRAINT order_pendency_dept_check
    CHECK (dept IN ('billing', 'drawing', 'purchase', 'qc'));
