-- 0040  Order Making's Assigned to, with its history: each assignment,
-- reassignment or unassignment of an SO's Sales Order details — from whom, to
-- whom, why (asked on a reassignment), who did it and when. Seeded from the
-- audit log's earlier assignments (no reason was asked then), and from the
-- assignment itself for an SO the log has none of. Same statements in
-- apps/so2dispatch/db/schema.sql. Idempotent and additive.

CREATE TABLE IF NOT EXISTS order_so_assignment_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    prev_assignee_id    UUID,
    prev_assignee_name  TEXT,
    new_assignee_id     UUID,
    new_assignee_name   TEXT,
    reason              TEXT,
    changed_by          UUID,
    changed_by_name     TEXT,
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_so_assignment_history_order_idx ON order_so_assignment_history (order_id, changed_at);

-- From the audit log: "Assigned SO details of #518 to Prashant Jaiswal", "Unassigned SO details of …".
INSERT INTO order_so_assignment_history (order_id, prev_assignee_name, new_assignee_name, changed_by, changed_by_name, changed_at)
SELECT a.order_id,
       lag(x.new_name) OVER (PARTITION BY a.order_id ORDER BY a.created_at),
       x.new_name, a.user_id, COALESCE(NULLIF(btrim(u.full_name), ''), a.user_email), a.created_at
  FROM audit_log a
  LEFT JOIN users u ON u.id = a.user_id
  CROSS JOIN LATERAL (SELECT CASE WHEN a.details LIKE 'Unassigned%' THEN NULL
                                  ELSE substring(a.details FROM ' to (.*)$') END AS new_name) x
 WHERE a.target = 'SO details assignment'
   AND EXISTS (SELECT 1 FROM orders o WHERE o.id = a.order_id)
   AND NOT EXISTS (SELECT 1 FROM order_so_assignment_history h WHERE h.order_id = a.order_id);

-- An SO assigned with nothing in the log: its assignment as it stands.
INSERT INTO order_so_assignment_history (order_id, new_assignee_id, new_assignee_name, changed_by, changed_by_name, changed_at)
SELECT o.id, o.so_assignee_id, au.full_name, o.so_assigned_by, COALESCE(NULLIF(btrim(bu.full_name), ''), bu.email), COALESCE(o.so_assigned_at, o.updated_at)
  FROM orders o
  LEFT JOIN users au ON au.id = o.so_assignee_id
  LEFT JOIN users bu ON bu.id = o.so_assigned_by
 WHERE o.so_assignee_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM order_so_assignment_history h WHERE h.order_id = o.id);

-- The old log also noted a save that kept the same person: not a change.
DELETE FROM order_so_assignment_history
 WHERE reason IS NULL AND prev_assignee_name IS NOT NULL AND lower(prev_assignee_name) = lower(new_assignee_name);
