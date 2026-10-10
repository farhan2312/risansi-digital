-- Idempotency markers for the non-deduped scheduled notifications (admin
-- escalation, weekly manager digest) so a repeat cron fire — a retry, a
-- double-schedule, or an unauthenticated hit — can't multiply the send. One row
-- per (kind, window); the sweep claims its window with INSERT … ON CONFLICT.
CREATE TABLE IF NOT EXISTS notification_runs (
  kind    text NOT NULL,
  run_key date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, run_key)
);
