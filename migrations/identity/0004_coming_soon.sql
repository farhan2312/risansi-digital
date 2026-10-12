-- 0004  An application can be visible but not yet open.
--
-- SO to Dispatch is on the grid because it exists and people use it, but it
-- has not been brought onto Risansi Digital yet. Until 12 Oct its tile was
-- indistinguishable from Testing's or Pump Selection's, so people did the
-- obvious thing and asked for access to something nobody can grant — and the
-- approver got a queue of requests with no right answer.
--
-- `is_live = false` was the alternative and is wrong here: it removes the tile
-- entirely, and a portal people use every day vanishing from the hub reads as
-- a fault rather than as "not yet".
--
-- Clearing this flag is all that is needed to open the application, once it
-- reads the shared session. No code change, no deploy.
ALTER TABLE identity.apps
  ADD COLUMN IF NOT EXISTS coming_soon boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN identity.apps.coming_soon IS
  'Shown on the grid, greyed, with no way to request access. For an application '
  'that exists but has not been migrated onto the shared session yet.';

UPDATE identity.apps SET coming_soon = true WHERE slug = 'so2dispatch';
