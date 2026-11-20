-- Remarks on an opportunity: a running thread, not a box.
--
-- Asked for on 20 Nov 2026 — "a common section wherein the users can just put
-- in any comments". A thread rather than a field because the question people
-- actually ask of an opportunity is "what did we agree, and when": a single
-- box answers that with whatever the last person typed over it.
--
-- The same shape as client_comments (migration 0022), deliberately: the same
-- columns, the same index, the same author-may-edit rule. Two tables that
-- answer the same question in two different shapes is how one of them ends up
-- with a feature the other never gets.
--
-- WHY NOT ON THE OPPORTUNITY ROW
--
-- `opportunities` already carries `notes` and a Lead / Discussion field, and
-- both are single values somebody overwrites. Neither can hold a conversation,
-- and widening either into one would rewrite what every existing row means.

CREATE TABLE IF NOT EXISTS opportunity_comments (
  id             serial PRIMARY KEY,
  opportunity_id integer NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  author_email   text NOT NULL,
  author_name    text,
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Oldest first is how the thread reads, but the index is written newest first
-- to match client_comments and because "the latest remark" is the commonest
-- single-row question.
CREATE INDEX IF NOT EXISTS idx_opportunity_comments_opp
  ON opportunity_comments(opportunity_id, created_at DESC);

COMMENT ON TABLE opportunity_comments IS
  'Free-form remarks on an opportunity. Anybody who can see the opportunity may add one; only the author may edit or delete it.';


-- ── Come back next season ──────────────────────────────────────────────────
--
-- When an opportunity is closed as "requirement closed, prospective for next
-- season", the person picks the date to come back on. That date is raised as a
-- task in the Action Registry, which is what actually brings it back — and
-- kept here too, so the opportunity itself can say when it is due without the
-- board having to read the registry for every closed row.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS revisit_on date;

COMMENT ON COLUMN opportunities.revisit_on IS
  'Set when the closing reason was "prospective for next season". The task raised against it is in tasks.';
