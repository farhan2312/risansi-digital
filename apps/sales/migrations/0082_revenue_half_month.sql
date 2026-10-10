-- 0082: revenue can be recorded by half-month.
--
-- Rows stay keyed on (client_id, month). A whole month sits on the 1st with
-- half NULL, as every row does today; the first fortnight sits on the 1st with
-- half = 1, the second on the 16th with half = 2. Range sums by month
-- boundary are unchanged; anything grouping by month uses date_trunc.

ALTER TABLE client_revenue_monthly
  ADD COLUMN IF NOT EXISTS half smallint CHECK (half IN (1, 2));

COMMENT ON COLUMN client_revenue_monthly.half IS
  'NULL = whole month (row on the 1st); 1 = days 1-15 (row on the 1st); 2 = day 16 to month end (row on the 16th).';
