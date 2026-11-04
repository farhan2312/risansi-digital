-- 0032  The order's pictures belong to the packing slip: Assembly & Packing adds
-- them, Dispatch sees them. Each link on a dispatch moves to that dispatch's
-- first slip. invoice_id stays, unread, so a server not yet updated still works;
-- deleting a dispatch no longer takes the pictures with it. The same statements
-- are in apps/so2dispatch/db/schema.sql. Idempotent and additive.

ALTER TABLE order_picture_links
    ADD COLUMN IF NOT EXISTS packing_slip_id UUID REFERENCES order_packing_slips(id) ON DELETE CASCADE;

ALTER TABLE order_picture_links ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE order_picture_links DROP CONSTRAINT IF EXISTS order_picture_links_invoice_id_fkey;
ALTER TABLE order_picture_links
    ADD CONSTRAINT order_picture_links_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES order_invoices(id) ON DELETE SET NULL;

UPDATE order_picture_links pl
   SET packing_slip_id = (SELECT l.packing_slip_id
                            FROM order_invoice_slips l
                            JOIN order_packing_slips ps ON ps.id = l.packing_slip_id
                           WHERE l.invoice_id = pl.invoice_id
                           ORDER BY ps.seq
                           LIMIT 1)
 WHERE pl.packing_slip_id IS NULL
   AND pl.invoice_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS order_picture_links_slip_link_uidx
    ON order_picture_links (packing_slip_id, link);
