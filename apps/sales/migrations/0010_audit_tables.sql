-- Comprehensive audit trail: authentication events + a general action log.
-- Both are read by the sysadmin Audit Log page. assignment_audit (ownership
-- diffs) and revenue_upload_log already exist and are surfaced alongside these.

-- ── Authentication / session events ──────────────────────────────
-- Every login attempt (success + failure), logout, and password change.
CREATE TABLE IF NOT EXISTS auth_audit (
  id          bigserial PRIMARY KEY,
  event       text NOT NULL,            -- login | logout | login_failed | password_changed
  email       text,
  user_id     bigint,
  role        text,
  ip          text,
  user_agent  text,
  reason      text,                     -- for failures: no_user | bad_password | not_approved
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_created ON auth_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_email   ON auth_audit (lower(email));
CREATE INDEX IF NOT EXISTS idx_auth_audit_event   ON auth_audit (event);

-- ── General action / activity audit ──────────────────────────────
-- Who did what, to which entity, from where. Captures create/update/delete/
-- submit/assign/export across clients, visits, contacts, opportunities, users,
-- tours, tasks, revenue uploads, etc.
CREATE TABLE IF NOT EXISTS audit_log (
  id            bigserial PRIMARY KEY,
  actor_email   text,
  actor_role    text,
  action        text NOT NULL,          -- create | update | delete | submit | assign | export | ...
  entity_type   text,                   -- client | visit | contact | opportunity | user | tour | task | revenue | auth | ...
  entity_id     text,
  entity_label  text,                   -- human-readable (client name, visit id, etc.)
  summary       text,                   -- one-line human description
  metadata      jsonb,                  -- before/after or extra detail
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON audit_log (lower(actor_email));
CREATE INDEX IF NOT EXISTS idx_audit_log_entity  ON audit_log (entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log (action);
