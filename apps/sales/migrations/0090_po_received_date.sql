-- When the PO arrived, as distinct from the date printed on it.
--
-- A customer dates a PO and sends it days later; the order is ours from the day
-- it reaches us, and that is the date a turnaround is measured from. Only the
-- printed date was recorded, so the two were indistinguishable.
--
-- Existing Won opportunities are backfilled to the PO date. That is the default
-- the form uses for a new one — enter either and the other follows until it is
-- edited — so it is the same assumption, applied to history rather than left
-- blank and looking like missing data.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS po_received_date date;

COMMENT ON COLUMN opportunities.po_received_date IS
  'The day the PO reached us. Defaults to po_date (the date printed on it) and is editable.';

UPDATE opportunities
   SET po_received_date = po_date
 WHERE po_received_date IS NULL AND po_date IS NOT NULL;
