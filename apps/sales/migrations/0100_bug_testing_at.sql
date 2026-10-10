-- When a bug reached testing, which is what turnaround should measure.
--
-- The KPI measured created_at → resolved_at, and resolved_at is only stamped
-- when a bug reaches "fixed". Fixed means the reporter has verified it, so the
-- figure included however long the bug sat waiting for someone to look at it —
-- and it excluded, entirely, the 21 bugs delivered and awaiting verification
-- right now. The number described the reporting loop, not the work.
--
-- testing_at is stamped the first time a bug reaches "testing", and also on a
-- jump straight to "fixed", so a bug closed without a testing round still has a
-- delivery time. It is cleared if the bug moves back before testing, the same
-- discipline resolved_at already follows, so a reopened bug cannot keep a stale
-- delivery date.
--
-- Backfill. There is no bug status history, so for the 71 already fixed there
-- is no evidence of when they reached testing and none is invented — they stay
-- NULL and sit outside the average. The 21 at testing are different: their last
-- change WAS the move to testing, so updated_at is the moment, not a guess.

ALTER TABLE bugs
  ADD COLUMN IF NOT EXISTS testing_at timestamptz;

COMMENT ON COLUMN bugs.testing_at IS
  'When the fix was first handed over for testing. Turnaround is measured to this, not to resolved_at.';

UPDATE bugs
   SET testing_at = updated_at
 WHERE status = 'testing' AND testing_at IS NULL AND updated_at IS NOT NULL;
