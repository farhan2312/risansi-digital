-- 0009  A vendor order's status, worked out from what has come in:
-- Pending, Partially received, or Fully received (received qty = order qty).
-- Apply to ec_to_dispatch before deploying the code that reads it; also in
-- apps/so2dispatch/db/schema.sql. Idempotent and additive.
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS vendor_status TEXT
    GENERATED ALWAYS AS (
      CASE
        WHEN vendor_order IS DISTINCT FROM 'Yes' THEN NULL
        WHEN COALESCE(order_qty, 0) > 0 AND COALESCE(received_qty, 0) >= order_qty THEN 'Fully received'
        WHEN COALESCE(received_qty, 0) > 0 THEN 'Partially received'
        ELSE 'Pending'
      END
    ) STORED;
