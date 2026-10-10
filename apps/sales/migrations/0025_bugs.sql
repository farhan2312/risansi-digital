-- Bug reports raised by portal users, worked through a status pipeline by the
-- system admin. Screenshot bytes live in a sidecar table so a plain SELECT on
-- bugs never drags the blob along (same pattern as opportunity_quotation_files).

CREATE TABLE IF NOT EXISTS bugs (
  id             serial PRIMARY KEY,
  title          text NOT NULL,
  description    text,
  page_url       text,                                 -- where the reporter hit it
  severity       text NOT NULL DEFAULT 'medium',       -- low | medium | high
  status         text NOT NULL DEFAULT 'reported',     -- reported|recorded|in_progress|testing|fixed

  reporter_id    integer REFERENCES users(id) ON DELETE SET NULL,
  reporter_name  text NOT NULL,                        -- snapshot, survives user deletion
  reporter_email text,

  -- Pipeline turnaround markers. recorded_* is stamped when the sysadmin first
  -- accepts the bug past "reported"; resolved_* when it reaches "fixed".
  recorded_by    text,
  recorded_at    timestamptz,
  resolved_by    text,
  resolved_at    timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),   -- reported at
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bugs_status_idx      ON bugs(status);
CREATE INDEX IF NOT EXISTS bugs_created_idx      ON bugs(created_at DESC);
CREATE INDEX IF NOT EXISTS bugs_reporter_idx     ON bugs(reporter_id);

CREATE TABLE IF NOT EXISTS bug_screenshots (
  bug_id      integer PRIMARY KEY REFERENCES bugs(id) ON DELETE CASCADE,
  file_name   text NOT NULL,
  mime        text NOT NULL DEFAULT 'image/png',
  size        integer,
  bytes       bytea NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
