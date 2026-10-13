-- 0001  Link each SO to Dispatch account to its Risansi Digital identity.
--
-- FOR FARHAN TO APPLY, against the ec_to_dispatch database. Step 2 of the
-- Phase 5 handover (Phase5-SO-to-Dispatch-Handover.docx).
--
-- The same statements are in apps/so2dispatch/db/schema.sql, which is that
-- app's single source of truth and is re-applied in full by
-- `npm run db:migrate` — every statement there must be idempotent, and these
-- are. This file is the excerpt to run on its own; running either is safe,
-- and running both, or running either twice, changes nothing the second time.
--
-- Additive and inert: nothing reads the column yet, and the portal keeps
-- signing people in exactly as it does today. Applying it changes no
-- behaviour at all.
--
-- ── Why a column and not a foreign key ───────────────────────────
--
-- `identity.users` lives in the `risansi_identity` database and Postgres has
-- no cross-database foreign key. The integrity a constraint would give comes
-- from the seed keeping both sides in step, and from the uniqueness below.
--
-- ── Why our uuids are NOT changing ───────────────────────────────
--
-- `users.id` stays the primary key, and every column pointing at it stays as
-- it is — orders (so_assignee_id, so_assigned_by), the audit log, messages,
-- reads, completions, notifications, bug reports. `identity_user_id` is the
-- only new fact: the same person's id in the other database.

ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_user_id uuid;

-- One account per identity. Partial, because the column is null until the
-- seed runs and stays null for anyone deliberately not carried across — the
-- shared mailboxes and admin@. This is what stops a seed run twice from
-- quietly pointing two accounts at one identity: the failure where two
-- people share a login and nothing looks wrong until one sees the other's
-- orders.
CREATE UNIQUE INDEX IF NOT EXISTS users_identity_user_id_key
  ON users (identity_user_id)
  WHERE identity_user_id IS NOT NULL;

COMMENT ON COLUMN users.identity_user_id IS
  'identity.users.id in the risansi_identity database. No FK: different database. '
  'Null means the account was deliberately not carried across and will not be able '
  'to sign in once the local login is retired.';
