-- The role axis for the complaint rebuild.
--
-- Two changes, both additive. Nothing existing moves, and every current user
-- keeps the role and the access they have today.
--
--   1. 'staff' joins the role check. It is NOT another rung on the
--      rep -> manager -> admin -> sysadmin ladder. That ladder is a ranking and
--      every permission test is `level >= required`, so a stores clerk placed
--      above 'rep' would inherit a rep's client visibility and pipeline, and one
--      placed below would see nothing at all. 'staff' is given level 0 in the
--      application, which means it satisfies no rung — its access comes from an
--      explicit allowance for Client 360 and Complaints, and from nowhere else.
--
--   2. `department` says which function somebody belongs to. It is a flat
--      attribute, not a rank: it decides which STAGE of a complaint they may
--      edit, and it is what "Responsible Department" should point at instead of
--      free text. It applies to any role — a manager can be in Quality — so it
--      is deliberately not limited to staff.
--
-- Nullable on purpose. All 41 existing users get NULL, which reads as "no
-- department", and no current behaviour consults the column.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['staff', 'rep', 'manager', 'admin', 'sysadmin']));

ALTER TABLE users ADD COLUMN IF NOT EXISTS department text;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_department_check;
ALTER TABLE users ADD CONSTRAINT users_department_check
  CHECK (department IS NULL OR department = ANY (ARRAY[
    'Quality', 'Service', 'Production', 'Stores', 'Accounts', 'Purchase', 'Dispatch'
  ]));

COMMENT ON COLUMN users.department IS
  'Function this person works in. Flat attribute, not a rank: drives which stage of a complaint they may edit. NULL for sales roles that have no department.';
