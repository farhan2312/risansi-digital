-- Customer Purchase Orders recorded against a Won opportunity. Unlike Sales
-- Orders (which fulfil the deal toward Won · Closed), POs are a free-standing
-- record of the customer's purchase orders — captured for reference, not tied to
-- the SO coverage maths. One Won opp can carry several POs. Values in CRORES to
-- match the rest of the opportunity money columns.
CREATE TABLE IF NOT EXISTS opportunity_purchase_orders (
  id             serial PRIMARY KEY,
  opportunity_id integer NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  po_number      text NOT NULL,
  po_date        date NOT NULL,
  po_value_cr    numeric(14,7) NOT NULL DEFAULT 0,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opp_po_opp ON opportunity_purchase_orders (opportunity_id);
