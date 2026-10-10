-- What actually happened when an action was closed.
--
-- tasks already records completed_at and completed_by — when it was closed and
-- by whom — but never what was done about it. An action registry that says only
-- "closed" cannot answer the question anyone asks a week later.
--
-- Deliberately nullable with no backfill. Every action closed before today has
-- no note and never will; inventing one would be worse than an honest blank.
-- The requirement applies from now on and is enforced in the action layer, not
-- by a NOT NULL constraint, precisely so the existing 30-odd closed rows stay
-- valid exactly as they are.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS resolution_note text;

COMMENT ON COLUMN tasks.resolution_note IS
  'What was done to close this action. Captured at the moment of closing and not editable afterwards. NULL on actions closed before this was introduced.';
