-- 0001  The identity schema: who you are, and what you may open.
--
-- Phase 2 of MIGRATION_PLAN.md. Nothing here is read by any portal yet. The hub
-- is the only consumer until Phase 3, so this migration cannot break anything
-- that is currently running.
--
-- Three ideas, kept apart on purpose:
--
--   identity.users       who you are      — one row per person, ever
--   identity.app_grants  what you may open — one row per person per portal
--   the portal's own user table   what you ARE inside it — rep_code, zone,
--                                 targets, its own role vocabulary
--
-- That last line is why this table has no `role`, no `zone` and no `rep_code`.
-- The sales portal's roles (rep / manager / admin / sysadmin / staff) have
-- nothing in common with SO to Dispatch's eleven (operations, accounts,
-- drawing, planning, qc, assembly, dispatch, …). There is no sensible global
-- role, so a grant carries an app-specific string and each portal keeps
-- interpreting its own.
--
-- `uuid` for the primary key, not `integer`. Three of the four portals already
-- use uuid for users; only sales uses integer, and sales is the one with 48
-- foreign keys pointing at its own ids. Those 48 are never touched: sales keeps
-- its integer `users.id` and gains a single `identity_user_id uuid` column
-- linking the two. See §4 of MIGRATION_PLAN.md.
--
-- Nothing in any portal foreign-keys to this schema. It cannot: the portals sit
-- in four separate databases and Postgres has no cross-database foreign key.
-- The link is a column, not a constraint, and that is deliberate rather than an
-- oversight.

CREATE SCHEMA IF NOT EXISTS identity;

-- ── People ────────────────────────────────────────────────────────
--
-- `role` here is about the hub itself, not about any portal: an approver can
-- decide access requests. One approver covers every application (decided
-- 10 Oct 2026), so there is no per-app approver table and no routing.
CREATE TABLE IF NOT EXISTS identity.users (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                text        NOT NULL,
  name                 text        NOT NULL,
  password_hash        text,
  -- Set when a password is issued rather than chosen. The hub refuses to let
  -- anyone past the change-password screen while this is true.
  must_change_password boolean     NOT NULL DEFAULT false,
  is_active            boolean     NOT NULL DEFAULT true,
  role                 text        NOT NULL DEFAULT 'member'
                                   CHECK (role IN ('member', 'approver')),
  last_seen_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness on email, the everyday key. An expression index
-- rather than citext, matching how the sales portal already does this —
-- citext is not allow-listed on Azure Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS identity_users_email_lower_key
  ON identity.users (lower(email));
CREATE INDEX IF NOT EXISTS identity_users_active ON identity.users (is_active);

-- ── The applications ──────────────────────────────────────────────
--
-- A table rather than a constant so a portal can be added, renamed or taken
-- off the grid without a deploy. `is_live` hides one from the tiles while
-- keeping every grant that already references it.
CREATE TABLE IF NOT EXISTS identity.apps (
  slug         text        PRIMARY KEY,
  name         text        NOT NULL,
  url          text        NOT NULL,
  blurb        text,
  -- Matches the 01–04 numbering on the existing hub page.
  sort_order   integer     NOT NULL DEFAULT 100,
  -- Some applications are open to anyone who can sign in — a calculator has
  -- nothing to protect. Those show as Open with no request step.
  needs_grant  boolean     NOT NULL DEFAULT true,
  is_live      boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Access, one row per person per application ────────────────────
--
-- Statuses are capitalised to match the sales portal's existing vocabulary
-- rather than the lowercase the other three use; one of the two had to win and
-- sales is the portal cutting over first.
--
--   Pending   requested, nobody has decided
--   Approved  may open it
--   Rejected  asked and was refused
--   Revoked   had it, and it was taken away
--
-- Rejected and Revoked are kept apart because they are different
-- conversations: one is "you were never given this", the other is "this was
-- taken from you", and a person asking why deserves the right answer.
CREATE TABLE IF NOT EXISTS identity.app_grants (
  id               bigserial   PRIMARY KEY,
  user_id          uuid        NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  app_slug         text        NOT NULL REFERENCES identity.apps(slug) ON DELETE CASCADE,
  status           text        NOT NULL DEFAULT 'Pending'
                               CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Revoked')),
  -- The portal's own role, set by the approver at the moment of approval.
  -- Deliberately a free string: see the header.
  app_role         text,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  -- Why they need it. The old sales sign-up form asked the requester to pick
  -- their own role, which is a claim; this asks for a reason instead and lets
  -- the approver set the role.
  requested_reason text,
  decided_by       uuid        REFERENCES identity.users(id) ON DELETE SET NULL,
  decided_at       timestamptz,
  decided_note     text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One grant per person per application. A second request for something already
-- held is an update to the existing row, not another row, so history stays on
-- one line and the tiles cannot show two states at once.
CREATE UNIQUE INDEX IF NOT EXISTS identity_app_grants_user_app_key
  ON identity.app_grants (user_id, app_slug);
CREATE INDEX IF NOT EXISTS identity_app_grants_pending
  ON identity.app_grants (status) WHERE status = 'Pending';

-- ── Audit ─────────────────────────────────────────────────────────
--
-- Append only. Every portal keeps its own log of what happened inside it; this
-- records only what happened to identity — signing in, being granted, being
-- revoked. Email is stored as text alongside user_id so a row still reads
-- correctly after an account is deleted, which is how the sales portal's
-- auth_audit already behaves.
CREATE TABLE IF NOT EXISTS identity.auth_events (
  id          bigserial   PRIMARY KEY,
  event       text        NOT NULL,
  email       text,
  user_id     uuid,
  app_slug    text,
  ip          text,
  user_agent  text,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS identity_auth_events_created ON identity.auth_events (created_at DESC);
CREATE INDEX IF NOT EXISTS identity_auth_events_email   ON identity.auth_events (lower(email));

-- ── The four applications as they stand today ─────────────────────
--
-- URLs and copy lifted from the existing static hub page so the grid reads
-- identically once it is rendered from the database. Pump Selection is marked
-- needs_grant = false: it is a calculator with no customer data behind it, and
-- gating it would add a request step that protects nothing. Change that to
-- true and it starts behaving like the others with no code change.
INSERT INTO identity.apps (slug, name, url, blurb, sort_order, needs_grant) VALUES
  ('sales', 'Sales Portal', 'https://sales.risansi.com',
   'Manage leads, clients, and the full opportunity pipeline — from first enquiry to won order.', 1, true),
  ('select', 'Pump Selection', 'https://select.risansi.com',
   'Size and select the right pump, and build the commercial offer around it.', 2, false),
  ('testing', 'Testing Portal', 'https://rndtesting.risansi.com',
   'Raise, schedule and record R&D test requisitions and their results.', 3, true),
  ('so2dispatch', 'SO to Dispatch', 'https://so2dispatch.risansi.com',
   'Follow an order from sales order through production to dispatch.', 4, true)
ON CONFLICT (slug) DO NOTHING;
