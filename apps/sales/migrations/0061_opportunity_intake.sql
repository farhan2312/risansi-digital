-- The opportunity redesign, part 1: everything additive.
--
-- Deliberately no DROP COLUMN here. The dead columns (equipment_id,
-- expected_close_date, secondary_rep_id and the four tsm_* ones) come out in a
-- later migration, once no code selects them — dropping a column the running
-- build still reads breaks the app for the length of a deploy, which is the
-- same mistake the quotation upsert made earlier.
--
-- Everything below is either a new column, a new table, or a rewrite of values
-- that keeps the row count identical.

-- ── 1 · The intake block ─────────────────────────────────────────
--
-- Asked wherever an opportunity is started. Constrained from the outset, so the
-- twelve-values-in-client_type story cannot repeat here.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS opportunity_type     text,
  ADD COLUMN IF NOT EXISTS opportunity_source   text,
  ADD COLUMN IF NOT EXISTS opportunity_category text,
  ADD COLUMN IF NOT EXISTS client_reference     text,
  ADD COLUMN IF NOT EXISTS suspect_reason       text,
  ADD COLUMN IF NOT EXISTS hold_reason          text,
  ADD COLUMN IF NOT EXISTS po_date              date;

-- NULL is allowed on every one: 1,803 opportunities already exist and were
-- never asked these questions. The forms require them going forward; inventing
-- answers for the back catalogue would be worse than an honest blank.
ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_opportunity_type_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_opportunity_type_check
  CHECK (opportunity_type IS NULL OR opportunity_type IN ('Pump', 'Spare'));

ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_opportunity_source_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_opportunity_source_check
  CHECK (opportunity_source IS NULL OR opportunity_source IN (
    'By Post', 'Email', 'WhatsApp', 'Tender Portal', 'India MART', 'Verbal'));

ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_opportunity_category_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_opportunity_category_check
  CHECK (opportunity_category IS NULL OR opportunity_category IN (
    'Against Rate Contract', 'New Enquiry', 'Repeat Order'));

ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_suspect_reason_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_suspect_reason_check
  CHECK (suspect_reason IS NULL OR suspect_reason IN (
    'Budgetary', 'Expansion within 1 year', 'Expansion more than 1 year'));

COMMENT ON COLUMN opportunities.opportunity_type IS 'Pump or Spare. A different axis from product_type — a spare for a PCP is still PCP.';
COMMENT ON COLUMN opportunities.opportunity_category IS 'Against Rate Contract / New Enquiry / Repeat Order. A rate contract or repeat order may go straight to Won without a quotation.';
COMMENT ON COLUMN opportunities.client_reference IS 'The client’s own reference — their PO, tender or email subject. Ours is enquiry_no.';
COMMENT ON COLUMN opportunities.suspect_reason IS 'Why the enquiry is parked at Suspect rather than progressing: Budgetary, or an expansion within / beyond a year.';
COMMENT ON COLUMN opportunities.po_date IS 'Date on the client’s purchase order. Mandatory alongside po_number at Won.';

-- ── 2 · Product type vocabulary ──────────────────────────────────
--
-- PCP / MMP / Spares / OBL / Service / Other becomes
-- PCP / MMP / RBL / OLB / SPARE / SERVICE / OTHER.
-- 'OBL' was a transposition of OLB, and 944 rows of 'Spares' become 'SPARE'.
-- Matched case-insensitively so a stray 'spares' from an import is caught too.

UPDATE opportunities SET product_type = 'SPARE'
 WHERE upper(btrim(product_type)) IN ('SPARE', 'SPARES');
UPDATE opportunities SET product_type = 'OLB'
 WHERE upper(btrim(product_type)) IN ('OLB', 'OBL');
UPDATE opportunities SET product_type = upper(btrim(product_type))
 WHERE upper(btrim(product_type)) IN ('PCP', 'MMP', 'RBL', 'SERVICE', 'OTHER');

-- The 147 rows with no product type keep none. They arrived by import and
-- nobody now knows what they were; the form requires it from here on.
ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_product_type_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_product_type_check
  CHECK (product_type IS NULL OR product_type IN (
    'PCP', 'MMP', 'RBL', 'OLB', 'SPARE', 'SERVICE', 'OTHER'));

-- ── 3 · Product / Description folds into Notes ───────────────────
--
-- The description is the identity of the deal, so it leads the note rather than
-- being appended to it. The `product` column is deliberately LEFT IN PLACE and
-- simply stops being read — so this merge can be checked against the original
-- before anything is thrown away.

UPDATE opportunities
   SET notes = CASE
         WHEN notes IS NULL OR btrim(notes) = '' THEN btrim(product)
         ELSE btrim(product) || E'\n\n' || notes
       END
 WHERE product IS NOT NULL AND btrim(product) <> ''
   -- Re-running must not prepend it twice.
   AND (notes IS NULL OR position(btrim(product) in notes) = 0);

-- ── 4 · The remark log ───────────────────────────────────────────
--
-- One dated list per opportunity instead of a remark column per stage. A deal
-- that goes On Hold, comes back, and is then Lost has three things worth
-- reading in order; five separate columns would scatter that, and a second
-- visit to a stage would overwrite the first.

CREATE TABLE IF NOT EXISTS opportunity_remarks (
  id              integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  opportunity_id  integer NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  stage           text NOT NULL,
  remark          text NOT NULL,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_remarks_opportunity_id_idx
  ON opportunity_remarks (opportunity_id, created_at, id);

COMMENT ON TABLE opportunity_remarks IS 'Dated remarks against an opportunity, one row per note, stamped with the stage it was written at.';
