-- 0080: Market on the nine quotes that had none (see 0079).
--
-- None belongs to an export rep (Susanta Pande, Shivanu Shukla, Anton Kozin,
-- Bernardo Espinola, Rajesh Thatha, Asif Iqbal quote export almost only; the
-- six reps here quote 88–100% domestic). Every client is in India. Two clients
-- carry other quotes that are all EXPORT — NETXEROC (2 of 2) and PAQUES
-- (1 of 1), both Himanshu's — so those two follow their client; the rest are
-- DOMESTIC, like the 1,241 other quotes.

UPDATE opportunities SET market = 'EXPORT', updated_at = now()
 WHERE id IN (5954, 5942) AND market IS NULL;

UPDATE opportunities SET market = 'DOMESTIC', updated_at = now()
 WHERE id IN (6015, 6028, 5766, 5413, 28, 25, 5408) AND market IS NULL;
