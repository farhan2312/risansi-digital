-- The client's last visit date, brought back in step with the visits.
--
-- Nothing in the database maintains this column: the visit action writes it
-- when somebody saves a report (app/actions/risansi-visits.ts), so a bulk load
-- of 653 historic visits leaves it untouched. 634 clients were showing an older
-- date, or none, than their own visits say — which is the one thing the
-- October sheet was sent in to fix.
--
-- Recomputed from completed visits only: a planned one has not happened.
-- It never moves a date backwards, so a client whose column is ahead of its
-- visit history for some other reason is left alone.

UPDATE clients cl
   SET last_visit_date = v.latest, updated_at = NOW()
  FROM (SELECT client_id, max(visit_date) AS latest
          FROM visits WHERE status = 'completed' GROUP BY client_id) v
 WHERE v.client_id = cl.id
   AND (cl.last_visit_date IS NULL OR v.latest > cl.last_visit_date);
