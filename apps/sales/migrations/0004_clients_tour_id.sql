-- 0004  Real FK from clients to tours, replacing the brittle tour_name string.
-- ADDITIVE: tour_name is kept (the app still reads it) until cutover.
-- Exactly one tour per client; NULL = unassigned (the admin mapper fixes these).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS tour_id integer REFERENCES tour_routes(id) ON DELETE SET NULL;

-- Backfill by exact name match. Non-matching values (e.g. the "Visit Not
-- Required" sentinel on 5 clients) correctly remain NULL.
UPDATE clients c
SET    tour_id = tr.id
FROM   tour_routes tr
WHERE  c.tour_id IS NULL
  AND  c.tour_name IS NOT NULL
  AND  c.tour_name = tr.name;

CREATE INDEX IF NOT EXISTS idx_clients_tour_id ON clients(tour_id);
