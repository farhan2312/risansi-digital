-- Self-service reports: a saved layout of visuals, and who it is shared with.
--
-- Two tables and nothing else. The report is a JSON document because its
-- shape is the user's, not ours: pages, visuals, which fields sit in which
-- well, where each card is on the grid. Normalising that would mean a schema
-- migration every time somebody wants a new visual type, and a join per card
-- to render a page.
--
-- What is NOT in here, on purpose:
--
--   The data.      A report stores the QUESTION, never an answer. Every
--                  number is computed at open time, in the scope of whoever
--                  is looking. This is what makes sharing safe: an admin can
--                  send "Revenue by industry" to a rep and the rep sees their
--                  own accounts, because the document carries no rows.
--   The pin.       One report per person, which is a user preference and
--                  lives in app_settings under 'report.pin:<user id>'
--                  alongside the other settings rather than earning a column.
--
-- The document is untrusted input in both directions: sanitised on write and
-- re-validated on every run. A row in here is something a user typed.

CREATE TABLE IF NOT EXISTS custom_reports (
  id          serial PRIMARY KEY,

  -- users.id. ON DELETE CASCADE: a withdrawn account's private reports go
  -- with it. Shares pointing at them go too, through their own cascade.
  owner_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  title       text NOT NULL,
  description text,

  -- ReportDoc: { version, pages[{ id, name, filters, visuals[] }] }.
  -- jsonb, not json: we read it far more often than we write it, and the
  -- binary form parses once on the way in rather than on every read.
  doc         jsonb NOT NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT custom_reports_title_len
    CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT custom_reports_desc_len
    CHECK (description IS NULL OR length(description) <= 500)
);

-- The two listings this table exists to serve: "my reports", newest first.
CREATE INDEX IF NOT EXISTS custom_reports_by_owner
  ON custom_reports (owner_id, updated_at DESC);

COMMENT ON TABLE custom_reports IS
  'A saved report: pages of visuals, as a JSON document. Holds the question, '
  'never the answer - every number is recomputed in the reader''s own data scope.';


CREATE TABLE IF NOT EXISTS custom_report_shares (
  id             serial PRIMARY KEY,
  report_id      integer NOT NULL REFERENCES custom_reports(id) ON DELETE CASCADE,
  user_id        integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Kept as text, and kept even if the sharer's account is later removed:
  -- "shared by" is a fact about the past, and a null there reads as though
  -- nobody did it.
  shared_by_name text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- Sharing the same report with the same person twice is one share, not two.
  CONSTRAINT custom_report_shares_once UNIQUE (report_id, user_id)
);

-- "Shared with me", the other listing.
CREATE INDEX IF NOT EXISTS custom_report_shares_by_user
  ON custom_report_shares (user_id, created_at DESC);

COMMENT ON TABLE custom_report_shares IS
  'Who a report is visible to besides its owner. View-only: edit, share and '
  'delete stay with the owner. A recipient may take their own copy.';
