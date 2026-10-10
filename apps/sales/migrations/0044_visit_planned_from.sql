-- Where an auto-planned visit came from.
--
-- Submitting a visit report with a "Next Visit Recommendation" date now raises a
-- Planned visit for that date. This column points that planned visit back at the
-- report that asked for it, which is what makes the follow-up editable: change
-- the recommendation later and the SAME planned visit moves, instead of a second
-- one appearing beside the first.
--
-- One planned visit per source report, enforced by the partial unique index
-- below — a re-submit or a double-click can't produce duplicates.
--
-- Deliberately no ON DELETE CASCADE: deleting the source report should not
-- silently remove a visit someone may already have planned their week around.
-- The rule is "a date change reschedules, nothing auto-deletes".

ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS planned_from_visit_id integer REFERENCES visits(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_visits_planned_from
  ON visits (planned_from_visit_id)
  WHERE planned_from_visit_id IS NOT NULL;
