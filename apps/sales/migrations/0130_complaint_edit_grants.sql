-- Editing a closed complaint, one complaint at a time, with a reason on it.
--
-- 352 of the 406 complaints on file are Closed, and a closed record still
-- needs correcting: a wrong date, a missing challan, a figure keyed badly.
-- Until now there were two ways to do it and neither was right.
--
--   Reopen          moves the complaint back through the workflow. It changes
--                   the record's state to fix a typo in it, and the lifecycle
--                   then carries a reopen that never happened.
--   app_settings    complaint_edit_override, a single global switch. While it
--                   was on, 19 edits were made across 9 complaints after they
--                   had closed; nothing said which complaints were meant to be
--                   open, who had asked, or why. canEditPage returns true
--                   outright on it, so it also lifted every department rule at
--                   the same time.
--
-- A grant is the narrow version. It names one complaint, carries a written
-- reason, expires by itself, and lifts ONLY the "this complaint is closed"
-- gate - the page's own department and assignment rules still decide who may
-- edit what. Someone who could not have edited page 5 while the complaint was
-- open still cannot edit it now.

CREATE TABLE IF NOT EXISTS complaint_edit_grants (
  id           serial PRIMARY KEY,
  complaint_id integer NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,

  -- Why. Not optional, and not a word: this is the whole point of the table.
  reason       text NOT NULL,

  -- The status the complaint was in when it was unlocked, kept so the audit
  -- reads the same in a year when the complaint has moved on.
  status_then  text NOT NULL,

  granted_by   text NOT NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),

  -- It closes itself. A window long enough to finish a correction and short
  -- enough that nobody has to remember to put it back.
  expires_at   timestamptz NOT NULL,

  -- Ended early, by hand.
  ended_at     timestamptz,
  ended_by     text,

  CONSTRAINT complaint_edit_grants_reason_len
    CHECK (length(btrim(reason)) >= 20),
  CONSTRAINT complaint_edit_grants_window
    CHECK (expires_at > granted_at)
);

-- One live grant per complaint. A second unlock while one is already running
-- would quietly extend the window without saying so.
CREATE UNIQUE INDEX IF NOT EXISTS complaint_edit_grants_one_live
  ON complaint_edit_grants (complaint_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS complaint_edit_grants_by_complaint
  ON complaint_edit_grants (complaint_id, granted_at DESC);

COMMENT ON TABLE complaint_edit_grants IS
  'Permission to edit one closed complaint, for a window, with a written reason. '
  'Lifts the Closed gate only; the page''s own department and assignment rules still apply.';
