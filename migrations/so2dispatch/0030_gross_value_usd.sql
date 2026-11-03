-- 0030  An order priced in USD carries its gross in both: Gross Order Value (USD)
-- here, and taxable_value (Gross Order Value) in INR at the order's own rate,
-- the figure invoices and payments count against. Orders already in USD move
-- over. The same statements are in apps/so2dispatch/db/schema.sql. Idempotent.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gross_value_usd NUMERIC(14,2);
UPDATE orders
   SET gross_value_usd = taxable_value,
       taxable_value = round(taxable_value * order_fx_rate, 2)
 WHERE upper(btrim(COALESCE(order_currency, ''))) = 'USD'
   AND gross_value_usd IS NULL
   AND taxable_value IS NOT NULL
   AND order_fx_rate IS NOT NULL;
