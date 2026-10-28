-- The two narrow roles were grantable before the users table could hold them.
--
-- identity/0009_sales_narrow_roles.sql catalogued 'viewer' (Client 360 View)
-- and 'registry' (Action Register) as sales app_roles, and lib/risansi-auth.ts
-- gained both in RisansiRole and in ROLE_LEVEL. What nobody did was widen
-- users_role_check, which 0069 had last set to
-- staff / rep / manager / admin / sysadmin.
--
-- That gap is a lockout, not a cosmetic drift. A person approved on the hub
-- has no row in this table until their first arrival, and salesRowFor()
-- provisions one with the role the grant carries. For a 'viewer' grant that
-- INSERT violates this constraint, the error is caught and logged, the
-- function returns null, and sessionFromSharedCookie() hands back no session —
-- so the hub tile looks like it simply reloads the hub. It locked out all
-- three people granted Client 360 View on 23 Oct 2026: Ananya Kumari,
-- Srasthi Tripathi and Parul Pal. Nobody who already had a row was affected,
-- which is why it went a week without being understood.
--
-- The list below is now exactly the keys of ROLE_LEVEL in
-- lib/risansi-auth.ts, and scripts/user-role-vocabulary-check.mjs fails the
-- build if the two ever disagree again.
--
-- Additive: no existing row changes, and nothing is granted by widening what
-- the column may hold. Access still comes from the grant's app_role, read on
-- every request.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY[
    'staff', 'viewer', 'registry', 'rep', 'manager', 'admin', 'sysadmin'
  ]));

COMMENT ON COLUMN users.role IS
  'Sales role. staff / viewer / registry are flat, level 0, functional: they satisfy no hasRole test and each door is opened for them by name. rep < manager < admin < sysadmin is the ladder. Must match ROLE_LEVEL in lib/risansi-auth.ts.';
