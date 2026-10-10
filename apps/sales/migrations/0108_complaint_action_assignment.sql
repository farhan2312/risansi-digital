-- Who gets the work, decided by what was done about it.
--
-- Page 5 asked the user to pick an assignee from every user in the system. The
-- answer is the same every time for a given action, and when it was picked by
-- hand it was picked wrong: the material actions belong to stores, a planned
-- visit belongs to the rep who owns the client, and everything else is the
-- Complaint Team's. So the action decides the assignee and the dropdown goes.
--
-- A table rather than a map in code, because this is an operational decision
-- that changes when people change roles, and the Complaint Team must be able to
-- edit it in Admin without a release. `assignee_kind` is the one thing code
-- needs to understand: 'user' is a named person, 'department' is everyone in
-- one, and 'client_rep' means look it up per complaint — the client's own
-- primary rep, who is a different person for every row.
--
-- Seeded from the requirement of 2 Oct. Kamini singh (users.id 46) is the only
-- Kamini on file and takes the seven actions that are the Complaint Team's.
-- Krishna, who the requirement names for the two material actions, has no user
-- account in this database — not under that name, nor as an email. Rather than
-- guess at an id, those two rows are seeded against the Complaint Team as a
-- department so the work lands somewhere real; point them at Krishna in Admin
-- once he has a login.

CREATE TABLE IF NOT EXISTS complaint_action_assignment (
  action        text    PRIMARY KEY,
  assignee_kind text    NOT NULL CHECK (assignee_kind IN ('user', 'department', 'client_rep')),
  user_id       integer REFERENCES users(id),
  department    text,
  CONSTRAINT complaint_action_assignment_target_chk CHECK (
    (assignee_kind = 'user'       AND user_id IS NOT NULL AND department IS NULL) OR
    (assignee_kind = 'department' AND department IS NOT NULL AND user_id IS NULL) OR
    (assignee_kind = 'client_rep' AND user_id IS NULL AND department IS NULL)
  )
);

COMMENT ON TABLE complaint_action_assignment IS
  'Which action taken on page 5 assigns the complaint to whom. Replaces the manual assignee dropdown, which was answered the same way every time and still got answered wrong. Editable in Admin.';
COMMENT ON COLUMN complaint_action_assignment.action IS
  'The action taken — a value of the action_category lookup.';
COMMENT ON COLUMN complaint_action_assignment.assignee_kind IS
  '''user'' for a named person, ''department'' for everyone in one, ''client_rep'' for the complaint''s own client''s primary rep, which differs per complaint and so cannot be stored here.';
COMMENT ON COLUMN complaint_action_assignment.user_id IS
  'The person, when assignee_kind is ''user''.';
COMMENT ON COLUMN complaint_action_assignment.department IS
  'The department, when assignee_kind is ''department''. Also the standing fallback for an action whose named owner has no login yet.';

-- A planned visit goes to the rep who owns the client, whoever that is.
INSERT INTO complaint_action_assignment (action, assignee_kind, user_id, department) VALUES
  ('Visit Planned', 'client_rep', NULL, NULL)
ON CONFLICT (action) DO NOTHING;

-- Calling material back and replacing it are stores work. Krishna owns both;
-- he has no user account, so the Complaint Team holds them until he does.
INSERT INTO complaint_action_assignment (action, assignee_kind, user_id, department) VALUES
  ('Call Back Material', 'department', NULL, 'Complaint Team'),
  ('Replace Material',   'department', NULL, 'Complaint Team')
ON CONFLICT (action) DO NOTHING;

-- Everything else is Kamini's, by name, matched on the users table rather than
-- hardcoded: if the row is missing the insert simply adds nothing and Admin
-- fills it in, instead of pointing the whole page at a wrong id.
INSERT INTO complaint_action_assignment (action, assignee_kind, user_id, department)
SELECT a.action, 'user', u.id, NULL
  FROM (VALUES
        ('Dispatch Material'),
        ('Under Discussion with Client'),
        ('Under Discussion with Vendor'),
        ('Free Replacement'),
        ('Under Investigation'),
        ('Client Confirmation')
       ) AS a(action)
  JOIN (SELECT id FROM users
         WHERE lower(name) LIKE 'kamini%' AND is_active
         ORDER BY id LIMIT 1) u ON TRUE
ON CONFLICT (action) DO NOTHING;
