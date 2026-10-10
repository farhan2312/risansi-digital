-- Index the columns every task read filters on.
--
-- tasks had exactly one index (its primary key), yet every query filters on
-- client_id (the tour-scope predicate), assigned_to_rep / created_by (the
-- "my actions" views), visit_id (the visit-report join) and status (open vs
-- completed). At 49 rows it's a seq scan either way, but the table only grows,
-- and the recently-tightened manager scope now filters on client_id on the
-- hottest page. Cheap to add ahead of the need.

CREATE INDEX IF NOT EXISTS idx_tasks_client   ON tasks (client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_rep       ON tasks (assigned_to_rep);
CREATE INDEX IF NOT EXISTS idx_tasks_visit     ON tasks (visit_id);
-- Open tasks are the ones the reminders sweep and the registry list read; a
-- partial index keeps it small and skips the completed history.
CREATE INDEX IF NOT EXISTS idx_tasks_open_due  ON tasks (due_date) WHERE status <> 'completed';
