-- 0012  Drop the direct client→rep assignment table.
--
-- Responsibility is now derived entirely from the client's tour: a client
-- belongs to one tour (clients.tour_id), and tour_assignments(tour_id, rep_id,
-- role) lists the reps and managers on that tour. Visibility and the
-- "responsible reps/managers" shown on Client 360 all come from there, so the
-- flat client_assignments many-to-many is no longer read or written by any
-- code (see commits switching every query to tour_assignments).
--
-- The 1,068 rows are backed up to migrations/backups/client_assignments_backup.json
-- before this runs, so the old direct assignments can be reconstructed if needed.

DROP TABLE IF EXISTS client_assignments;
