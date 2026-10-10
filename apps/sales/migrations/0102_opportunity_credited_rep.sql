-- One client, one owner, one set of figures.
--
-- The rule chosen on 1 Oct 2026: a client has a single owner, their primary
-- rep, and everything attached to that client is attributed to that owner no
-- matter who raised it or worked it. Before this, 422 of 2,086 opportunities
-- named a rep other than the client's owner, 267 of them Won worth 4.69 Cr, so
-- the same deal was credited to one person on the board and another on the
-- Executive Review depending on which column that page happened to read.
--
-- Attribution is therefore DERIVED, not stored: every figure now reads the
-- client's primary_rep_id. opportunities.rep_id is left exactly as it is and
-- keeps its old meaning — the person who raised the enquiry or was assigned to
-- work it — because deleting that is destroying a record to fix a reporting
-- bug, and nothing in the rule requires it.
--
-- Two decisions have to live together, and this column is how:
--
--   1. A one-time reset to TODAY'S owner, history included. Past figures
--      restate. That is deliberate, and it needs no data change at all: with
--      credited_rep_id NULL everywhere, every row reads the owner the client
--      has right now.
--   2. From here on, only OPEN items follow a reassignment. When a client
--      changes hands, work still in play goes to the new owner and work that
--      already closed stays with the person who held the account while it was
--      live, so nobody's Won history evaporates because an account moved.
--
-- So credited_rep_id is normally NULL and means "follow the client's owner,
-- live". setPrimaryRep stamps it — with the OUTGOING owner — on the closed
-- opportunities of a client that is changing hands, and on nothing else. That
-- freezes their credit at the moment the account moves, which is the only
-- moment at which the derived answer would otherwise change behind them.
--
-- It is left NULL for open rows on purpose. An open opportunity has to follow
-- the owner, and a column that is only written when it has to be is a column
-- that cannot drift: 2,086 rows start at NULL and only an actual handover ever
-- writes one.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS credited_rep_id integer REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN opportunities.credited_rep_id IS
  'Frozen attribution. NULL (the normal case) means credit follows clients.primary_rep_id live. Set to the outgoing owner by setPrimaryRep on opportunities that had already closed when the client changed hands, so closed credit stays with whoever held the account. Never a substitute for rep_id, which still records who raised or was assigned the enquiry.';

-- Only the handful of rows a handover has frozen are ever looked up by this
-- column, so a partial index is the whole index worth having.
CREATE INDEX IF NOT EXISTS idx_opportunities_credited_rep
  ON opportunities (credited_rep_id) WHERE credited_rep_id IS NOT NULL;
