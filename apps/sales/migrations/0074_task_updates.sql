-- A history for actions.
--
-- An action carried exactly one piece of narrative: the resolution note written
-- when it was closed. Everything before that — the date being pushed out twice,
-- the call that went unanswered, the reason it slipped — happened in people's
-- heads or on WhatsApp, and the registry could only show the current due date
-- with no trace of what it had been. So when a rep opens an action to move its
-- date or mark it done, they now say why, and every one of those entries is
-- kept here and shown back the next time anyone opens it.
--
-- One row per update. `kind` says what happened; the date columns are filled
-- only for a date move so the old value survives; `comment` is the words.
-- Actor is the login email, resolved to a name when read, so a renamed or
-- deactivated user still shows as who they were.

CREATE TABLE IF NOT EXISTS task_updates (
  id           bigserial PRIMARY KEY,
  task_id      integer     NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('comment', 'due_date', 'completed', 'reopened')),
  comment      text,
  old_due_date date,
  new_due_date date,
  actor_email  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_updates_task ON task_updates (task_id, created_at);

COMMENT ON TABLE task_updates IS
  'Every comment, due-date move, closure and reopening on an action, in order. tasks.resolution_note keeps the FIRST closure''s words; this keeps all of them.';

-- The closures already on record become the first entries, so an action closed
-- last month does not open to an empty history.
INSERT INTO task_updates (task_id, kind, comment, actor_email, created_at)
SELECT t.id, 'completed', t.resolution_note, t.completed_by, COALESCE(t.completed_at, t.updated_at, now())
  FROM tasks t
 WHERE t.status = 'completed'
   AND NOT EXISTS (SELECT 1 FROM task_updates u WHERE u.task_id = t.id AND u.kind = 'completed');
