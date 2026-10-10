-- Departments are a SET, not a field.
--
-- 0069 put a single `department` on users, and that was wrong twice over:
--
--   * People hold more than one. Stores and Dispatch are the same person in
--     several places here, and that person has to be able to work both stages
--     of a complaint rather than pick which half of their job the portal knows
--     about.
--
--   * A department is not an alternative to a sales role. A rep who is also
--     responsible for dispatch keeps every bit of their rep access and gains a
--     stage; they are not a staff user and must not be turned into one to
--     record what they do.
--
-- So: role stays one value and means sales standing. Departments become zero or
-- more rows here and mean which complaint stages this person may work. The two
-- are independent — role 'rep' with {Dispatch}, role 'staff' with
-- {Stores, Dispatch}, role 'manager' with {Quality}, or any role with none at
-- all — which is the combination the single column could not express.
--
-- users.department is deliberately left in place by this migration. The build
-- currently running still selects it, and dropping a column out from under a
-- live deployment is how the portal broke for four minutes in September. 0071
-- removes it once this code is deployed.

CREATE TABLE IF NOT EXISTS user_departments (
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department text    NOT NULL,
  added_by   text,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, department),
  CONSTRAINT user_departments_department_check CHECK (department = ANY (ARRAY[
    'Quality', 'Service', 'Production', 'Stores', 'Accounts', 'Purchase', 'Dispatch'
  ]))
);

CREATE INDEX IF NOT EXISTS idx_user_departments_dept ON user_departments(department);

-- Carry over anything 0069 recorded. Expected to move nothing: the column has
-- been live for one deployment and every row is NULL. Written anyway, because a
-- migration that assumes the table is empty is a migration that loses data the
-- one time it is not.
INSERT INTO user_departments (user_id, department, added_by)
SELECT id, department, 'migration:0070'
  FROM users
 WHERE department IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON TABLE user_departments IS
  'Which functions a person works in. Zero or more per user, independent of their role: a rep can hold Dispatch and keep full rep access. Drives which stage of a complaint they may edit.';
