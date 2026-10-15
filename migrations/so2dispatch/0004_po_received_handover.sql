-- 0004  PO Receiving Date, and the Handover dates.
--
-- Apply to ec_to_dispatch BEFORE deploying the code that reads them. The same
-- statements are in apps/so2dispatch/db/schema.sql (npm run db:migrate).
-- Idempotent and additive: the standalone ECtoDispatch portal is unaffected.

-- First of the Purchase Order details: when the PO came in (not for an FR).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS po_received_date DATE;

-- Handover: when the EC went to Operations (filled by Order Making SO) and
-- to PPC (filled by Central Visibility).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ec_sent_operation_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ec_sent_ppc_date DATE;
