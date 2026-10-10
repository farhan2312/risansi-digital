-- Free-form comments / notes on a client, shown in the Client 360 Comments box.
-- Anyone who can see the client may add a comment; only the original author may
-- edit or delete their own. Newest first.

CREATE TABLE IF NOT EXISTS client_comments (
  id           serial PRIMARY KEY,
  client_id    integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  author_email text NOT NULL,
  author_name  text,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_comments_client ON client_comments(client_id, created_at DESC);
