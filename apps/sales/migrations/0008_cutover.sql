-- 0008  Destructive cutover. Finishes the move off the deprecated `reps` and
-- `access_requests` tables and the legacy `clients` owner / tour-name columns.
-- Safe to run only AFTER all app code reads/writes the unified model
-- (users + client_assignments + clients.tour_id). Runs in one transaction.

-- 1. Null/reassign any references to people absent from `users` (the purged
--    junk test reps), so the repointed FKs to users(id) are satisfiable.
UPDATE visits SET rep_id = NULL
  WHERE rep_id IS NOT NULL AND rep_id NOT IN (SELECT id FROM users);

UPDATE tasks SET assigned_to_rep = NULL
  WHERE assigned_to_rep IS NOT NULL AND assigned_to_rep NOT IN (SELECT id FROM users);

UPDATE opportunities o SET rep_id = COALESCE(
    (SELECT ca.user_id FROM client_assignments ca
       WHERE ca.client_id = o.client_id ORDER BY ca.assigned_at, ca.user_id LIMIT 1),
    (SELECT id FROM users WHERE role = 'sysadmin' ORDER BY id LIMIT 1))
  WHERE o.rep_id IS NOT NULL AND o.rep_id NOT IN (SELECT id FROM users);

UPDATE opportunities SET secondary_rep_id = NULL
  WHERE secondary_rep_id IS NOT NULL AND secondary_rep_id NOT IN (SELECT id FROM users);

UPDATE tour_routes SET primary_rep_id = NULL
  WHERE primary_rep_id IS NOT NULL AND primary_rep_id NOT IN (SELECT id FROM users);

-- tour_assignments.rep_id is NOT NULL, so junk rows must be deleted (not nulled).
DELETE FROM tour_assignments WHERE rep_id NOT IN (SELECT id FROM users);

-- 2. Drop EVERY foreign key still pointing at the old reps table.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname, cl.relname AS tbl
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    WHERE con.contype = 'f' AND con.confrelid = 'reps'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- 3. Repoint the foreign keys we keep onto users(id).
ALTER TABLE visits           ADD CONSTRAINT visits_rep_id_fkey
  FOREIGN KEY (rep_id)          REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks            ADD CONSTRAINT tasks_assigned_to_rep_fkey
  FOREIGN KEY (assigned_to_rep) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE opportunities    ADD CONSTRAINT opportunities_rep_id_fkey
  FOREIGN KEY (rep_id)          REFERENCES users(id);
ALTER TABLE opportunities    ADD CONSTRAINT opportunities_secondary_rep_id_fkey
  FOREIGN KEY (secondary_rep_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tour_assignments ADD CONSTRAINT tour_assignments_rep_id_fkey
  FOREIGN KEY (rep_id)          REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE tour_routes      ADD CONSTRAINT tour_routes_primary_rep_id_fkey
  FOREIGN KEY (primary_rep_id)  REFERENCES users(id) ON DELETE SET NULL;

-- 4. Drop the legacy clients owner / tour-name columns (app no longer uses them).
ALTER TABLE clients
  DROP COLUMN IF EXISTS primary_rep_id,
  DROP COLUMN IF EXISTS secondary_rep_id,
  DROP COLUMN IF EXISTS primary_rep_name,
  DROP COLUMN IF EXISTS secondary_rep_name,
  DROP COLUMN IF EXISTS tour_name;

-- 5. Drop the deprecated tables. access_requests first; nothing references reps now.
DROP TABLE IF EXISTS access_requests;
DROP TABLE IF EXISTS reps;

-- 6. Remove the redundant duplicate unique constraint on tour_routes.name,
--    keeping the original tour_routes_name_key.
ALTER TABLE tour_routes DROP CONSTRAINT IF EXISTS tour_routes_name_unique;
