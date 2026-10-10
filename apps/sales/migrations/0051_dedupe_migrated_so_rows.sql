-- Correct an over-broad insert in 0050.
--
-- 0050 guarded with "NOT EXISTS (... WHERE s.opportunity_id = o.id AND s.so_number = o.po_number)"
-- — i.e. per-OPPORTUNITY. But a sales-order number identifies one physical document,
-- so it must be unique across opportunities, not within one. Three SOs had already
-- been recorded by hand (mona.rathour@risansi.com, 2026-08-03) against the QUOTE row
-- of a duplicated deal, while 0050 inserted a second copy against the order-in-hand
-- row of that same deal:
--   SO26/1/520  opp 3837 (migrated) + opp 5481 (manual)
--   SO26/1/637  opp 3828 (migrated) + opp 5482 (manual)
--   SO26/1/761  opp 3830 (migrated) + opp 5483 (manual)
-- That double-counted Rs 58,61,240 of sales-order coverage and understated Order in
-- Hand by the same amount.
--
-- The manual rows win: they were entered by a human, they carry a real so_date (0050
-- could only supply NULL), and they sit on the richer quote row that will survive the
-- pending duplicate merge. Removing the migrated copy leaves those three order-in-hand
-- rows reading "won, awaiting SO", which is honest — they are duplicate records queued
-- for removal, not orders missing paperwork.

DELETE FROM opportunity_sales_orders dup
 WHERE dup.created_by = 'migration:0050-so-from-po'
   AND EXISTS (
         SELECT 1 FROM opportunity_sales_orders keep
          WHERE keep.so_number      = dup.so_number
            AND keep.opportunity_id <> dup.opportunity_id
            AND keep.created_by IS DISTINCT FROM 'migration:0050-so-from-po');

-- Restore the po_number 0050 cleared on those three order-in-hand rows? No: the value
-- it held was an SO number, which never belonged in the customer-PO field. The SO is
-- preserved on the surviving manual row, so nothing is lost.
