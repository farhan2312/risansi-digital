-- OLB joins Pump and Spare as an opportunity type.
--
-- The column carries a CHECK naming the allowed values, so the form offering a
-- third one is not enough on its own: the save would be refused by the
-- database. The constraint is replaced rather than dropped, so a typo still
-- cannot get in.
--
-- NULL stays legal. 1,016 opportunities predate the field being asked for and
-- have no type; this is not the migration that backfills them.

ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_opportunity_type_check;

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_opportunity_type_check
  CHECK (opportunity_type IS NULL OR opportunity_type IN ('Pump', 'Spare', 'OLB'));
