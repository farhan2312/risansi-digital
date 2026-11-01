-- Suspect becomes Prospect; the empty Prospect stage becomes Budgetary Quotation.
--
-- The names were carrying the wrong meanings. "Suspect" held 239 enquiries and
-- 195 of them — 82% — had their reason set to "Budgetary", so the siding for
-- parked enquiries was in practice the budgetary-quotation list. "Prospect"
-- held nothing at all.
--
-- 195, not the 211 rows that carry that reason: the other 16 have long since
-- moved on to Quoted or Won and keep the stage they are actually in.
--
-- After this:
--
--   Prospect             any lead, or a discussion with a client worth keeping.
--                        Asks for an expected date and what was said.
--   Budgetary Quotation  an indicative price, to help somebody size a project.
--                        Out of the open pipeline and out of the forecast.
--   Quoted               a real quotation, and it now says on its face whether
--                        it is Budgetary or Non-budgetary.
--
-- Order matters. Prospect is emptied into Budgetary Quotation FIRST, so that
-- renaming Suspect into Prospect cannot collide with rows already sitting
-- there. Prospect holds 0 rows today, so the first statement is a no-op on
-- current data and is here to make the migration correct rather than lucky.

BEGIN;

-- 1. The old Prospect stage (empty today) becomes Budgetary Quotation.
UPDATE opportunities SET stage = 'Budgetary Quotation' WHERE stage = 'Prospect';

-- 2. The 195 Suspects already marked Budgetary join them. Their suspect_reason
--    is left on the row: it is how they were classified and it is the evidence
--    for this move, so erasing it would destroy the audit of the migration.
UPDATE opportunities
   SET stage = 'Budgetary Quotation'
 WHERE stage = 'Suspect' AND suspect_reason = 'Budgetary';

-- 3. Everything still in Suspect is a lead. That is what Prospect means now.
UPDATE opportunities SET stage = 'Prospect' WHERE stage = 'Suspect';

-- 4. The stage history, under the same mapping, so a log entry and the record
--    it describes use one vocabulary. Done in the same order and for the same
--    reason as above.
UPDATE opportunity_stage_log SET from_stage = 'Budgetary Quotation' WHERE from_stage = 'Prospect';
UPDATE opportunity_stage_log SET to_stage   = 'Budgetary Quotation' WHERE to_stage   = 'Prospect';
UPDATE opportunity_stage_log SET from_stage = 'Prospect'            WHERE from_stage = 'Suspect';
UPDATE opportunity_stage_log SET to_stage   = 'Prospect'            WHERE to_stage   = 'Suspect';

-- 5. Is this quotation an offer, or a price to size a project by?
--
-- Asked from Budgetary Quotation onward, so a deal that reaches a formal Quoted
-- and only then turns out to have been indicative can still say so. NULL means
-- non-budgetary, which is what every row written before today holds — the
-- predicate that reads it (NOT_BUDGETARY in lib/risansi-dashboard.ts) coalesces
-- rather than treating the absence as unknown.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS quotation_type text;

ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_quotation_type_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_quotation_type_check
  CHECK (quotation_type IS NULL OR quotation_type = ANY (ARRAY['Budgetary', 'Non-budgetary']));

COMMENT ON COLUMN opportunities.quotation_type IS
  'Budgetary or Non-budgetary. A budgetary quotation is an indicative price and '
  'is excluded from the open pipeline and the forecast. NULL reads as Non-budgetary.';

-- 6. Everything that just moved into Budgetary Quotation IS budgetary, by
--    definition of the stage it is in. Say so on the row as well, so the
--    forecast rule holds whichever way it is asked.
UPDATE opportunities SET quotation_type = 'Budgetary'
 WHERE stage = 'Budgetary Quotation' AND quotation_type IS NULL;

-- suspect_reason keeps its own CHECK, which still allows 'Budgetary'. The value
-- is no longer offered by any form (see SUSPECT_REASONS in
-- lib/risansi-opportunity-fields.ts) and the 211 rows that hold it are the
-- record of where they came from.
COMMENT ON COLUMN opportunities.suspect_reason IS
  'How far out a Prospect is, when it is not live yet. Named for the stage that '
  'was called Suspect until Nov 2026. ''Budgetary'' is a stage of its own now and '
  'is no longer offered; the rows holding it predate the change.';

COMMIT;
