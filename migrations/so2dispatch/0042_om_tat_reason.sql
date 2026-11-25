-- 0042  Order Making's TAT: an SO is to go to Operation within 48 hours of its
-- PO Receiving Date. Sent later, Order Making PO gives the reason it was late.
-- Same statements in apps/so2dispatch/db/schema.sql. Idempotent and additive.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS om_tat_reason TEXT;
