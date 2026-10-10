-- 0006  Enforce uniqueness of tour names (the org relies on names being unique,
-- and the client→tour backfill matched on name). No-op if already constrained.

DO $$
BEGIN
  ALTER TABLE tour_routes ADD CONSTRAINT tour_routes_name_unique UNIQUE (name);
EXCEPTION
  WHEN duplicate_table  THEN NULL;  -- constraint already exists (named)
  WHEN duplicate_object THEN NULL;  -- equivalent unique constraint exists
END $$;
