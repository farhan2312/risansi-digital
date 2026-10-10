-- Marks that a visit's per-visit pump data (competitor equipment + sugar /
-- non-sugar pump counts) has been seeded forward from a previous visit, so the
-- copy runs exactly once and never clobbers data the rep has since entered.
-- Holds the source visit id (or the visit's own id as a "handled, nothing to
-- copy" sentinel is NOT used — null simply means "not yet seeded").
ALTER TABLE visits ADD COLUMN IF NOT EXISTS prefilled_from_visit_id integer;
