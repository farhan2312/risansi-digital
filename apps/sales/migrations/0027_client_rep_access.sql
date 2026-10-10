-- Special access: grant a rep direct access to a client, independent of the
-- client's tour. Admins/sysadmins manage these grants from the Client Master
-- page. A granted rep gets full visibility of the client (it shows in their
-- lists/dashboard, they can plan visits and create opportunities for it) exactly
-- as if it were on one of their tours.
CREATE TABLE IF NOT EXISTS client_rep_access (
  id          serial PRIMARY KEY,
  client_id   integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rep_id      integer NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  granted_by  text,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, rep_id)
);

CREATE INDEX IF NOT EXISTS idx_client_rep_access_rep    ON client_rep_access (rep_id);
CREATE INDEX IF NOT EXISTS idx_client_rep_access_client ON client_rep_access (client_id);
