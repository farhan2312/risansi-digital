-- 0028  What the invoices alone make of an SO's dispatch gets its own column,
-- so dispatch_status can always read as the portal shows it: the status set
-- by hand if there is one, else this. The same statements are in
-- apps/so2dispatch/db/schema.sql. Idempotent; changes no dispatch_status.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_dispatch_status TEXT;
UPDATE orders SET invoice_dispatch_status = COALESCE(NULLIF(dispatch_status, ''), 'Pending')
 WHERE invoice_dispatch_status IS NULL;
