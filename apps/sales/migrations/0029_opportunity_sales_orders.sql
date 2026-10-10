-- Sales Orders against a Won opportunity. One Won opp can be fulfilled by
-- several SOs over time (the client takes part of the order now, rest later),
-- so this is a 1-to-many child of opportunities. Values are in CRORES to match
-- opportunities.value_cr / final_value_cr for exact aggregation & comparison.
--
-- Derived status (not stored): a Won opp is "Open" while SUM(so_value_cr) is
-- below final_value_cr, and "Closed" once it reaches/exceeds it. "Order in Hand"
-- is SUM over Won opps of GREATEST(final_value_cr - SUM(so_value_cr), 0).
CREATE TABLE IF NOT EXISTS opportunity_sales_orders (
  id             serial PRIMARY KEY,
  opportunity_id integer NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  so_number      text NOT NULL,
  so_date        date NOT NULL,
  so_value_cr    numeric(14,7) NOT NULL DEFAULT 0,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opp_so_opp ON opportunity_sales_orders (opportunity_id);
