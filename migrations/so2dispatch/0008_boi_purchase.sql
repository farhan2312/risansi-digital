-- 0008  Bought-out items: quantity on the EC form, and Purchase's two ways of
-- covering it — RIL stock allocated, and an order placed with a vendor.
--
-- Apply to ec_to_dispatch BEFORE deploying the code that reads them; the same
-- statements are in apps/so2dispatch/db/schema.sql. Idempotent and additive.
-- (expected_receipt_date is now the Vendor Expected Date, receipt_date the
-- Received Date.)
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS boi_qty INT;
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS stock_allocated_qty INT;
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS vendor_order TEXT;
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS vendor_code TEXT;
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS vendor_name TEXT;
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS ril_po_no TEXT;
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS ril_po_date DATE;
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS vendor_so_no TEXT;
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS vendor_so_date DATE;
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS order_qty INT;
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS rate_per_unit NUMERIC(14,2);
-- Always rate x order quantity: worked out by the database, never typed.
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS total_value NUMERIC(16,2)
    GENERATED ALWAYS AS (rate_per_unit * order_qty) STORED;
ALTER TABLE order_boi_items ADD COLUMN IF NOT EXISTS received_qty INT;

-- Every change to a vendor's expected date, as the readiness dates keep theirs.
CREATE TABLE IF NOT EXISTS order_boi_expected_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boi_item_id     UUID NOT NULL REFERENCES order_boi_items(id) ON DELETE CASCADE,
    prev_date       DATE,
    new_date        DATE,
    changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_by_role TEXT,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_boi_expected_history_item_idx
    ON order_boi_expected_history (boi_item_id, changed_at);
