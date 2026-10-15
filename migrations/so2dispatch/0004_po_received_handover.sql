-- 0004  PO Receiving Date, the Handover, and Packing & Forwarding %.
--
-- Apply to ec_to_dispatch BEFORE deploying the code that reads them. The same
-- statements are in apps/so2dispatch/db/schema.sql (npm run db:migrate).
-- Idempotent and additive (the one DROP is a column added and never filled
-- on 15 Oct 2026): the standalone ECtoDispatch portal is unaffected.

-- First of the Purchase Order details: when the PO came in (not for an FR).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS po_received_date DATE;

-- Handover: when the SO went to Operations (filled by Order Making SO). When
-- it went to PPC is the existing so_handover_date ("SO Sent to PPC Date").
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ec_sent_operation_date DATE;
ALTER TABLE orders DROP COLUMN IF EXISTS ec_sent_ppc_date;

-- Packing & Forwarding %, between Discount % and GST %; Taxable Value is
-- worked out from them in the forms.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS packing_forwarding_percent NUMERIC(5,2);
