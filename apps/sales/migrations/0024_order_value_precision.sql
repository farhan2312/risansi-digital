-- Order/opportunity values are denominated in CRORES, but the columns were
-- numeric(10,2) — a quantisation grid of ₹1,00,000. Any order under a lakh
-- rounded to 0.00 and the exact figure was lost. Widen to 7 decimals (₹1
-- resolution) and give the order book its own exact-rupee column, mirroring
-- opportunities.offer_value_inr.
--
-- Non-lossy: scale only widens, and the largest existing value_cr is 2.37.

ALTER TABLE opportunities ALTER COLUMN value_cr       TYPE numeric(14,7);
ALTER TABLE opportunities ALTER COLUMN final_value_cr TYPE numeric(14,7);
ALTER TABLE orders        ALTER COLUMN order_value_cr TYPE numeric(14,7);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_value_inr numeric;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_value_usd numeric;
