-- Clients a visit is not expected for, and why.
--
-- The coverage numbers have been counting every ACTIVE client as somebody who
-- owes a visit. Plenty do not: the account that orders by mail and has no
-- field potential, the plant that has shut, the one nobody can get hold of.
-- Counting those as "never visited" made the gap look like neglect when it was
-- a decision somebody had already taken and had nowhere to write down.
--
-- The reason is the point. A bare "exempt" flag would be a hole in the
-- numbers; a reason is a statement the rep has to stand behind, visible in
-- Client 360 and listed by reason on the executive review.
--
-- `until` exists for the temporary ones. "Visit planned" is true for a quarter,
-- not forever, and a waiver with a date on it stops applying by itself rather
-- than quietly draining the denominator for years. NULL means open-ended,
-- which is right for a sick unit and wrong for a plan.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS visit_waiver       text,
  ADD COLUMN IF NOT EXISTS visit_waiver_note  text,
  ADD COLUMN IF NOT EXISTS visit_waiver_until date,
  ADD COLUMN IF NOT EXISTS visit_waiver_by    bigint,
  ADD COLUMN IF NOT EXISTS visit_waiver_at    timestamptz;

-- Codes are closed: the UI offers five and the column takes those five. A free
-- text reason would be unaggregatable, and the executive review groups by this.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_visit_waiver_code') THEN
    ALTER TABLE clients ADD CONSTRAINT clients_visit_waiver_code
      CHECK (visit_waiver IS NULL OR visit_waiver IN
             ('not_required', 'planned', 'unreachable', 'declined', 'sick_unit'));
  END IF;
END $$;

-- Every coverage query filters on "is this one waived", so the partial index
-- covers exactly the rows that answer yes.
CREATE INDEX IF NOT EXISTS idx_clients_visit_waiver
  ON clients (visit_waiver) WHERE visit_waiver IS NOT NULL;

COMMENT ON COLUMN clients.visit_waiver IS
  'Why no visit is expected. NULL = a visit is expected and the client counts in the coverage gap.';
COMMENT ON COLUMN clients.visit_waiver_until IS
  'Last day the waiver applies. NULL = open-ended. Past = expired, and the client counts again.';
