-- 0121  Link each sales account to its Risansi Digital identity.
--
-- Phase 3 step 2 of MIGRATION_PLAN.md. Additive and inert: nothing reads this
-- column yet. Sales still signs people in with NextAuth against its own
-- `password_hash`, and will until step 3.
--
-- A column, not a foreign key, and that is not an omission. `identity.users`
-- lives in its own database (decision §2.6, four separate databases), and
-- Postgres has no cross-database foreign key. The integrity that would
-- normally come from a constraint comes instead from the seed script keeping
-- both sides in step, and from the uniqueness below.
--
-- What this is NOT: a change to `users.id`. That stays `integer` and all 48
-- foreign keys pointing at it are untouched — that is the whole reason
-- identity got its own uuid key rather than everyone adopting one. See §4.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS identity_user_id uuid;

-- One sales account per identity, and one identity per sales account.
--
-- Partial, because the column is null for every row until the seed runs and
-- stays null for anyone who never gets an identity. A plain unique index would
-- be satisfied by many nulls in Postgres anyway; being explicit says the rule
-- is about the rows that HAVE a value.
--
-- This is what stops the seed being run twice from quietly pointing two sales
-- accounts at one identity — the failure mode where two people end up sharing
-- a login and nothing looks wrong until one of them sees the other's clients.
CREATE UNIQUE INDEX IF NOT EXISTS users_identity_user_id_key
  ON users (identity_user_id)
  WHERE identity_user_id IS NOT NULL;

COMMENT ON COLUMN users.identity_user_id IS
  'identity.users.id in the risansi_identity database. No FK: different database. '
  'Set by the Phase 3 step 2 seed; read from step 3 onward.';
