-- Remove the single `department` column that 0069 added.
--
-- Safe to run only now. 0070 created user_departments and copied anything the
-- column held (nothing — it was live for one deployment and every row was
-- NULL), and the build that reads the join table instead is deployed. Running
-- this before that deploy would have taken the column out from under a running
-- build's jwt callback, which is the same mistake that took the portal down for
-- four minutes in September.
--
-- Nothing reads users.department any more: the session, the admin screen and
-- both write paths all go through user_departments.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_department_check;
ALTER TABLE users DROP COLUMN IF EXISTS department;
