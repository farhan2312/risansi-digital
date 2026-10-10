-- Client type: 12 values collapse to a clean list, and the column is constrained
-- so it cannot drift again.
--
-- The app has only ever offered six (lib/risansi-client-types.ts). The extra six
-- arrived through a one-off bulk import that wrote the column directly, so the
-- dropdown never saw them: DIRECT MILL and End User are the same thing, as are
-- GROUP and Group (Mills), and TRADER is Trader with the shift key held down.
-- Nearly 38% of clients had no type at all.
--
-- Blanks become 'Unclassified' rather than being guessed into End User. End User
-- is the commonest value, so it is the best single guess — and that is exactly
-- the problem: 1,022 guesses would be indistinguishable from 1,022 verified
-- classifications. Unclassified says "nobody has told us yet", which is true,
-- and leaves them filterable for whoever works through them.

UPDATE clients SET client_type = 'End User'
 WHERE btrim(upper(client_type)) = 'DIRECT MILL';

UPDATE clients SET client_type = 'Group (Mills)'
 WHERE btrim(upper(client_type)) = 'GROUP';

UPDATE clients SET client_type = 'Trader'
 WHERE btrim(client_type) <> 'Trader' AND btrim(upper(client_type)) = 'TRADER';

-- Trailing spaces from the import would otherwise survive as separate values.
UPDATE clients SET client_type = btrim(client_type)
 WHERE client_type IS NOT NULL AND client_type <> btrim(client_type);

UPDATE clients SET client_type = 'Unclassified'
 WHERE COALESCE(btrim(client_type), '') = '';

-- CHANNEL PARTNER and Head Office (one client each) are deliberately left as
-- they are and are named in the constraint so that editing those two clients
-- still works. Once they are reclassified, drop them from this list — that is
-- the whole remaining cleanup.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_client_type_check;
ALTER TABLE clients ADD CONSTRAINT clients_client_type_check CHECK (
  client_type IN (
    'End User', 'OEM', 'EPC', 'Trader', 'Group (Mills)', 'Merchant Exporter',
    'Unclassified',
    'CHANNEL PARTNER', 'Head Office'   -- legacy, 1 client each, remove when fixed
  )
);

-- NOT NULL now that nothing is blank: "no client type" is no longer a state the
-- table can represent, which is what was asked for.
ALTER TABLE clients ALTER COLUMN client_type SET DEFAULT 'Unclassified';
ALTER TABLE clients ALTER COLUMN client_type SET NOT NULL;
