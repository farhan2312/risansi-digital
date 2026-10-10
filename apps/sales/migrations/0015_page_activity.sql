-- 0015  Per-page activity tracking.
--
-- One row per "flush" from the client ActivityTracker: how many ACTIVE seconds
-- a signed-in user spent on a given page (active = tab visible and not idle).
-- Aggregated in the Audit Log → Usage tab into per-user active time, sessions,
-- and per-page breakdowns. session_id groups a browser session (per login tab).

CREATE TABLE IF NOT EXISTS page_activity (
  id             bigserial PRIMARY KEY,
  user_email     text,
  user_id        integer,
  role           text,
  session_id     text,
  path           text NOT NULL,
  active_seconds integer NOT NULL DEFAULT 0,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_activity_user    ON page_activity(lower(user_email), occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_activity_session ON page_activity(session_id);
CREATE INDEX IF NOT EXISTS idx_page_activity_path    ON page_activity(path);
