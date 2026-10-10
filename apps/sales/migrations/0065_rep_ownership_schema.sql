-- Rep ownership, phase 2: the shape, with nothing reading it yet.
--
-- Ownership is moving off the tour and onto the client. This migration only adds
-- the places for it to live. No column is dropped, no visibility rule changes,
-- and every query in the application behaves exactly as it did before — which is
-- what makes this safe to run ahead of the code that uses it.
--
-- The model:
--   clients.primary_rep_id   the one owner, and the default owner of new work
--   client_secondary_reps    others who cover the account, full access, many per client
--   manager_reps             a manager sees everything owned by the reps beneath them
--
-- primary_rep_id is deliberately NULLABLE for now. 67 clients are being parked
-- without an owner on purpose and 39 more are absent from the source sheet, so a
-- NOT NULL constraint today would either block the backfill or force a wrong
-- answer onto a hundred records. It is added in a later migration, once the
-- Unassigned tab shows zero.

-- ── the single owner ──────────────────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS primary_rep_id integer REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN clients.primary_rep_id IS
  'The rep who owns this account. Mandatory in the interface, nullable in the '
  'schema until every client has one. Default owner of new opportunities, visits '
  'and actions. ON DELETE SET NULL rather than RESTRICT: removing a user should '
  'never be blocked by their book, it should surface the clients as unassigned.';

-- Reading "who owns this" and "what do I own" are both hot paths.
CREATE INDEX IF NOT EXISTS idx_clients_primary_rep ON clients(primary_rep_id)
  WHERE deleted_at IS NULL;

-- ── the people who also cover the account ─────────────────────────
CREATE TABLE IF NOT EXISTS client_secondary_reps (
  client_id  integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rep_id     integer NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  added_by   integer          REFERENCES users(id)   ON DELETE SET NULL,
  added_at   timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, rep_id)
);

COMMENT ON TABLE client_secondary_reps IS
  'Reps who cover a client alongside its primary. Same access as the primary, '
  'including edit, but never the default owner of new work — that is always the '
  'primary. Deliberately NOT client_rep_access: that table means "an exception '
  'was granted" and stays auditable as such, while a secondary rep is the normal '
  'arrangement.';

CREATE INDEX IF NOT EXISTS idx_client_secondary_reps_rep ON client_secondary_reps(rep_id);

-- ── the hierarchy ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manager_reps (
  manager_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rep_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by   integer          REFERENCES users(id) ON DELETE SET NULL,
  added_at   timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (manager_id, rep_id),
  -- Self-management would make the visibility rule circular for no gain: a
  -- manager already sees their own clients by owning them.
  CONSTRAINT manager_reps_not_self CHECK (manager_id <> rep_id)
);

COMMENT ON TABLE manager_reps IS
  'A manager sees every client owned or covered by the reps beneath them. A rep '
  'may sit under more than one manager. Only one level is modelled: this is not '
  'a tree, and a manager under another manager grants nothing transitively — the '
  'tours it replaces were never a hierarchy, and inventing one would be guessing.';

CREATE INDEX IF NOT EXISTS idx_manager_reps_rep ON manager_reps(rep_id);
