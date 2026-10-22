-- Per-rep targets for three things, not one.
--
-- Revenue targets already existed as users.target_cr: one numeric column, no
-- year. That shape cannot hold the two metrics now being asked for (new
-- clients and visits), and it cannot hold last year's revenue target either —
-- April would overwrite it and the comparison nobody could make afterwards is
-- "did we do better than last year".
--
-- So: one row per person, per financial year, per metric.
--
--   revenue_cr    numeric, Crores, to match users.target_cr and the company
--                 figure in app_settings.annual_target_cr
--   new_clients   a count
--   visits        a count
--
-- fy is the code getCurrentFY() already produces ('26-27'), so the dashboard,
-- the Executive Review and this table all say the year the same way.

CREATE TABLE IF NOT EXISTS rep_targets (
  user_id     integer        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fy          text           NOT NULL,
  metric      text           NOT NULL,
  value       numeric(14,4)  NOT NULL,
  updated_by  text,
  updated_at  timestamptz    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, fy, metric),
  -- Spelled out rather than left open: a typo in a metric name would store a
  -- target that nothing ever reads back, and look like the save silently failed.
  CONSTRAINT rep_targets_metric_known CHECK (metric IN ('revenue_cr', 'new_clients', 'visits')),
  -- A negative target is always a typo. Zero is allowed and means "no target",
  -- which the dashboard shows as no bar rather than as 0% achieved.
  CONSTRAINT rep_targets_value_sane CHECK (value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_rep_targets_fy ON rep_targets (fy, metric);

-- Carry the revenue targets already set on Admin › Settings into the current
-- year, so nobody re-enters sixteen numbers that are already right.
--
-- users.target_cr is deliberately NOT dropped here. The Executive Review still
-- reads it, and a column removed in the same change that starts writing
-- somewhere else leaves no way back if the new path is wrong. Retiring it
-- belongs with the Phase 3 step 5 cleanup.
INSERT INTO rep_targets (user_id, fy, metric, value, updated_by)
SELECT u.id, '26-27', 'revenue_cr', u.target_cr, 'migration 0122'
  FROM users u
 WHERE u.target_cr IS NOT NULL AND u.target_cr >= 0
ON CONFLICT (user_id, fy, metric) DO NOTHING;
