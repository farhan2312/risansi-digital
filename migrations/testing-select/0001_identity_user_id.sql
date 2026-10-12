-- 0001  Link each Testing and Pump Selection account to its Risansi Digital
--       identity.
--
-- FOR THE TESTING / PUMP SELECTION TEAM TO APPLY. It is written as plain SQL
-- rather than an Alembic revision because that database is yours and its
-- revision chain is yours; wrap it in a revision of your own rather than
-- letting this file become a second source of truth for the schema.
--
-- Phase 4 of MIGRATION_PLAN.md. Additive and inert: nothing reads these
-- columns, and both portals keep signing people in exactly as they do today.
-- Applying it changes no behaviour at all.
--
-- ── Why a column and not a foreign key ───────────────────────────
--
-- `identity.users` lives in the `risansi_identity` database (decision §2.6,
-- four separate databases) and Postgres has no cross-database foreign key.
-- The integrity a constraint would give comes instead from the link script
-- keeping both sides in step, and from the uniqueness below.
--
-- ── Why your uuids are NOT changing ──────────────────────────────
--
-- The plan originally said identity would adopt the Testing uuids so nothing
-- would have to be rewritten. That is not available: every person who exists
-- in both `users` and `users_pump` carries a DIFFERENT uuid in each, so there
-- was never a single id to adopt.
--
-- The answer is the one the sales portal already took — keep your own key and
-- add a pointer. That matters more here than it did there, because only four
-- declared foreign keys point at these two tables while eighteen further uuid
-- columns reference a user with no constraint at all (`audit_log.user_id`,
-- `quotation.created_by`, `step_approval.decided_by`, and so on). Nothing in
-- the database would stop a remap from silently orphaning those rows, and
-- some of them point at `users` while others point at `users_pump` with no
-- way to tell from the schema which. So: do not remap. Every existing id
-- stays exactly as it is, and `identity_user_id` is the only new fact.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS identity_user_id uuid;

ALTER TABLE users_pump
  ADD COLUMN IF NOT EXISTS identity_user_id uuid;

-- One account per identity, and one identity per account, within each table.
--
-- Partial, because the column is null until the link script runs and stays
-- null for anyone deliberately not carried across — the shared mailboxes and
-- the test logins. A plain unique index would be satisfied by many nulls in
-- Postgres anyway; being explicit says the rule is about rows that have a
-- value.
--
-- This is what stops the link script being run twice from quietly pointing
-- two accounts at one identity: the failure where two people share a login
-- and nothing looks wrong until one of them sees the other's work.
--
-- Note the index is per table on purpose. One person legitimately holds both
-- a Testing and a Pump Selection account pointing at the same identity — that
-- is the whole point of the merge — so uniqueness across the two would be
-- wrong.
CREATE UNIQUE INDEX IF NOT EXISTS users_identity_user_id_key
  ON users (identity_user_id)
  WHERE identity_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_pump_identity_user_id_key
  ON users_pump (identity_user_id)
  WHERE identity_user_id IS NOT NULL;

COMMENT ON COLUMN users.identity_user_id IS
  'identity.users.id in the risansi_identity database. No FK: different database. '
  'Set by scripts/link-testing-select-identity.mjs. Null means the account was '
  'deliberately not carried across and will not be able to sign in after cutover.';

COMMENT ON COLUMN users_pump.identity_user_id IS
  'identity.users.id in the risansi_identity database. No FK: different database. '
  'Set by scripts/link-testing-select-identity.mjs.';
