-- "Other" as a drop reason, with room to say what actually happened.
--
-- Two answers were missing from the Dropped list: a budgetary enquiry, which
-- was never a project to lose, and Other. Other on its own tells a review
-- nothing, so it comes with a line of free text; the move into Dropped refuses
-- to save an Other with nothing typed against it.
--
-- Same shape as lost_to_competitor_other, which hangs off "Others" in the Lost
-- list for the same reason.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS drop_reason_other text;

COMMENT ON COLUMN opportunities.drop_reason_other IS
  'Why the enquiry was dropped, in words. Only set when drop_reason = ''Other''.';
