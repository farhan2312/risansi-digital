-- In-app notifications: the feed behind the bell.
--
-- Until now the bell in the top bar was a disabled placeholder — every event
-- notification went out as email only (lib/risansi-notify.ts). This table backs
-- a real in-app inbox: one row per RECIPIENT per event, so each person sees only
-- what was addressed to them, with their own read state.
--
-- It sits ALONGSIDE email, not instead of it. The same senders that email a
-- manager also drop a row here for that manager; external (non-user) recipients
-- still only get email, since they have no account to read a feed in.
--
-- Rows are cheap and self-expiring in practice (the UI shows the recent slice),
-- but nothing deletes them yet — a later sweep can prune read rows older than N
-- days if volume ever warrants it.

CREATE TABLE IF NOT EXISTS notifications (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,                 -- machine tag, e.g. 'opp_won', 'complaint_closed'
  section     text,                          -- display group, e.g. 'Pipeline', 'Complaints'
  title       text NOT NULL,
  body        text,
  link        text,                          -- in-portal path the item opens
  actor       text,                          -- who caused it (email), for display
  entity_type text,
  entity_id   text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The bell's two queries: unread count, and the recent feed — both per user,
-- newest first. One partial-friendly composite index serves both.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- Fast unread count without scanning read rows.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id) WHERE read_at IS NULL;
