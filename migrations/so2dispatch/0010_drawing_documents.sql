-- 0010  Drawing by document: every pump EC has a GAD; it has a Performance
-- Curve too when its SO asks for one (orders.performance_curve_required).
-- Each document is kept as versions (rows of order_drawing_revisions with
-- that doc_type): sent to the client, approved or sent back to resubmit, and
-- for a GAD issued to the workshop. Existing rows are GAD versions.
-- Apply to ec_to_dispatch before deploying the code that reads it; also in
-- apps/so2dispatch/db/schema.sql. Idempotent and additive.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS performance_curve_required TEXT;
ALTER TABLE order_drawing_revisions ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'GAD';
ALTER TABLE order_drawing_revisions ADD COLUMN IF NOT EXISTS remarks TEXT;
