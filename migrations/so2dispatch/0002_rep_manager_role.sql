-- 0002  Allow the Rep Manager role on SO to Dispatch accounts.
--
-- FOR FARHAN TO APPLY, against the ec_to_dispatch database — BEFORE any grant
-- is set to rep_manager at the hub. Until it is, an account cannot take that
-- role here: the copy of the grant's role into users.role is refused, and a
-- new person arriving as rep_manager cannot be created.
--
-- The same statement is in apps/so2dispatch/db/schema.sql (re-applied in full
-- by `npm run db:migrate`). Idempotent. Additive: every role allowed before
-- is still allowed, so the standalone ECtoDispatch portal on the same
-- database is unaffected.
--
-- A Rep Manager sees their own SOs and those of the reps who report to them.
-- Who reports to whom is read live from the sales portal's manager_reps — it
-- is not stored here.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD  CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'central_visibility', 'operations', 'accounts',
                    'drawing', 'planning', 'purchase', 'qc',
                    'assembly', 'dispatch', 'order_making', 'order_making_so', 'rep',
                    'rep_manager'));
