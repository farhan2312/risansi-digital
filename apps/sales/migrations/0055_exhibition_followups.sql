-- Post-event review: per-meeting follow-up, expense sign-off, and closing.
--
-- This is where the module deliberately stops being read-only about the CRM. Up
-- to now its only tie to existing data was a client lookup. During the review the
-- owner decides what each meeting turns into, and that decision creates a REAL
-- record: a planned visit, a task in someone's Action Registry, or an opportunity
-- in the pipeline. The link columns below remember which record came from which
-- meeting, so the trail runs both ways and nothing is created twice.
--
-- A visit and an opportunity both require a client_id (and an opportunity a
-- rep_id too), so those two are only offered for meetings the lookup matched to
-- an existing client. tasks.client_id is nullable, so an Action can always be
-- raised — including for a company we do not know. The module still never
-- creates a client.

ALTER TABLE exhibition_meetings
  ADD COLUMN IF NOT EXISTS follow_up_type text
    CHECK (follow_up_type IN ('None','Visit','Action','Opportunity')),
  ADD COLUMN IF NOT EXISTS follow_up_owner_id    integer REFERENCES users(id)        ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS follow_up_note        text,
  ADD COLUMN IF NOT EXISTS follow_up_set_at      timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_set_by      integer REFERENCES users(id)        ON DELETE SET NULL,
  -- ON DELETE SET NULL, not CASCADE: deleting a visit or an opportunity must not
  -- destroy the record of the conversation that produced it.
  ADD COLUMN IF NOT EXISTS linked_visit_id       integer REFERENCES visits(id)        ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_task_id        integer REFERENCES tasks(id)         ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_opportunity_id integer REFERENCES opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exhibition_meetings_followup
  ON exhibition_meetings (exhibition_id, follow_up_type);

ALTER TABLE exhibitions
  ADD COLUMN IF NOT EXISTS expenses_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expenses_reviewed_by integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by            integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reopened_at          timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by          integer REFERENCES users(id) ON DELETE SET NULL;

-- Closing and reopening join the same append-only trail as the approval
-- decisions, so the history reads as one story rather than two.
ALTER TABLE exhibition_approvals DROP CONSTRAINT IF EXISTS exhibition_approvals_decision_check;
ALTER TABLE exhibition_approvals ADD CONSTRAINT exhibition_approvals_decision_check
  CHECK (decision IN ('Submitted','Exhibit','Visit','Reject','More Info','Closed','Reopened'));

COMMENT ON COLUMN exhibition_meetings.follow_up_type IS
  'What the review decided this meeting becomes. Visit and Opportunity require a matched client_id; Action does not.';
