-- Rep ownership, the last step: drop tour_assignments.
--
-- The table mapped a person to a route, and a client's route decided who could
-- see it. Ownership replaced that in migration 0065: clients.primary_rep_id
-- names the one owner, client_secondary_reps names anyone covering the account,
-- and manager_reps puts a manager above them. Phase 8 converted the last query
-- that still consulted a route to decide anything, so by the time this runs the
-- table has been write-only for a release and read by nothing.
--
-- Routes themselves are NOT going anywhere. tour_routes stays, clients.tour_id
-- stays, the route dropdown on the client form stays, and the zone/route filters
-- on Field Activity stay. A route is an attribute of a client — which is what it
-- was asked to become. What is being removed is the claim that standing on one
-- grants access to the clients of everyone else standing on it.
--
-- Before running this:
--   * archive/tour_assignments-315.sql holds every row plus the live DDL, so
--     the table can be rebuilt from this repo. A DROP TABLE is the one migration
--     another migration cannot undo.
--   * scripts/tour-assignments-archive.mjs confirmed no inbound foreign key and
--     no view depends on it, so nothing else falls over.
--   * The deployed build no longer references it. Dropping a table the running
--     code still selects from is the failure this ordering exists to avoid.

DROP TABLE IF EXISTS tour_assignments;

-- The audit trail keeps its history. assignment_audit rows with
-- entity_type = 'tour_assignment' record who was put on which route and when;
-- they are a log of what happened, not a pointer into a table, so they stay
-- readable and stay true.

COMMENT ON TABLE tour_routes IS
  'A sales route. An attribute of a client (clients.tour_id) used for grouping, '
  'filtering and reporting. It grants nobody access to anything: that is decided '
  'by clients.primary_rep_id, client_secondary_reps and manager_reps.';
