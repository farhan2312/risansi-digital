-- EPC is no longer a client type.
--
-- No client carries it: the ten that did were re-typed on 1 October, and the
-- type has been taken off the client form. The CHECK is tightened so it cannot
-- come back through an import or a hand-written update while nothing in the
-- portal offers it.
--
-- Guarded rather than assumed: if any client is typed EPC when this runs, the
-- constraint is left alone and the migration says so, because silently
-- refusing a value that live rows still hold would break the next save on them.

DO $$
DECLARE epc_count int;
BEGIN
  SELECT count(*) INTO epc_count FROM clients WHERE upper(btrim(client_type)) = 'EPC';
  IF epc_count > 0 THEN
    RAISE NOTICE 'Skipped: % client(s) are still typed EPC. Re-type them, then re-run.', epc_count;
  ELSE
    ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_client_type_check;
    ALTER TABLE clients ADD CONSTRAINT clients_client_type_check
      CHECK (client_type IN ('End User','OEM','Trader','Group (Mills)',
                             'Merchant Exporter','Unclassified','CHANNEL PARTNER','Head Office'));
    RAISE NOTICE 'EPC retired from the client_type constraint.';
  END IF;
END $$;
