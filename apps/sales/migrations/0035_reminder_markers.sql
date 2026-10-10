-- Dedupe markers for the scheduled reminder sweeps (Vercel cron): once an
-- overdue action / complaint has been reminded on a given calendar day, it isn't
-- reminded again until the next day. NULL = never reminded.
ALTER TABLE tasks      ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;
