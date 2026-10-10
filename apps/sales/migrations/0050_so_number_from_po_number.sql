-- Move our OWN sales-order numbers out of the CUSTOMER's purchase-order field.
--
-- The June-2026 "order in hand" import wrote values like 'SO26/1/637' into
-- opportunities.po_number. That column is the customer's purchase-order number
-- (real examples still in there: '4200060035', 'CPD/26-27/0675/10P203', 'NPSM/43')
-- and it is labelled "PO Number" on the Excel export, the edit drawer, the Won
-- completion modal and the kanban card. An SO is ours; a PO is theirs. They are
-- different documents from different parties, and the schema already models them
-- separately (opportunity_sales_orders / opportunity_purchase_orders).
--
-- Two further consequences of the mis-filing this fixes:
--   * 532 of 586 populated po_number values (91%) were actually SO numbers, so
--     nearly every "PO Number" a rep saw was wrong.
--   * Order-in-Hand is computed as (final value - value covered by sales orders).
--     Because none of these SOs were in opportunity_sales_orders, all 530 orders
--     read as "won, awaiting SO" and the KPI overstated at ~Rs 23.81 Cr.
--
-- Rollback: the inserted rows are tagged created_by = 'migration:0050-so-from-po',
-- and each carries the exact string that was removed from po_number, so the change
-- is fully reversible:
--   UPDATE opportunities o SET po_number = s.so_number
--     FROM opportunity_sales_orders s
--    WHERE s.opportunity_id = o.id AND s.created_by = 'migration:0050-so-from-po';
--   DELETE FROM opportunity_sales_orders WHERE created_by = 'migration:0050-so-from-po';

-- 1. The import carries no SO dates and we will not invent them. An imported
--    historical order with a genuinely unknown date belongs as NULL, not as a
--    fabricated one. Manual entry still requires a date (validated in addSalesOrder);
--    every read path already tolerates NULL (ORDER BY sorts them last).
ALTER TABLE opportunity_sales_orders ALTER COLUMN so_date DROP NOT NULL;

-- 2. Create the real sales-order row from the value we already hold. so_value_cr
--    and final_value_cr are both numeric(14,7), so no precision is lost — at the
--    older numeric(10,2) 150 of these would have silently rounded to Rs 0.00.
--    The NOT EXISTS guard skips opportunities whose SO is already recorded
--    properly (2 rows, where po_number is a stale duplicate of the real SO row);
--    inserting those again would double-count their value.
INSERT INTO opportunity_sales_orders (opportunity_id, so_number, so_date, so_value_cr, created_by)
SELECT o.id, o.po_number, NULL, o.final_value_cr, 'migration:0050-so-from-po'
  FROM opportunities o
 WHERE o.po_number ~* '^SO[0-9]'
   AND o.final_value_cr IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM opportunity_sales_orders s
          WHERE s.opportunity_id = o.id AND s.so_number = o.po_number);

-- 3. Clear every SO-shaped value out of the PO field, including the 2 stale
--    duplicates skipped above. Genuine customer POs (54 rows) are untouched.
UPDATE opportunities
   SET po_number = NULL, updated_at = NOW()
 WHERE po_number ~* '^SO[0-9]';

-- 4. Write the distinction down where the next person will see it.
COMMENT ON COLUMN opportunities.po_number IS
  'CUSTOMER purchase-order number. Never our sales-order number — those belong in opportunity_sales_orders.so_number.';
COMMENT ON COLUMN opportunity_sales_orders.so_number IS
  'RISANSI sales-order number (e.g. SO26/1/637). so_date may be NULL for rows imported without a date.';
