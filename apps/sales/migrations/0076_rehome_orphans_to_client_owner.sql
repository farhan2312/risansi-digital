-- Orphans go to the client's owner; one archived client comes back.
--
-- Yesterday's rule (whyCannotWorkClient, orphanSql): a visit or an opportunity
-- whose rep is a stranger to the client — not its owner, not covering it, not
-- a manager of either — is Blocked until the assignment is sorted. That left
-- 122 open opportunities and 11 open visits blocked, most of them quotes an
-- admin had raised on somebody else's client naming a rep who does not work
-- it. Decided 13 Sep: sort them by moving each to the client's primary rep,
-- who is the person Client 360 and the board's Rep filter already say owns
-- the work. Closed records (Won, Lost, Dropped; completed or submitted visits)
-- are history and are left alone.
--
-- Also: BIJA01D019 · DNYANYOGI SHIVKUMAR SWAMI SUGAR was archived in the 30 Aug
-- duplicate sweep with a visit report on it. It is not a duplicate of Indian
-- Cane Power's Dnyanyogi unit — confirmed 13 Sep, two separate clients — so it
-- is restored, report and all.

-- A stranger to the client, in SQL — the same definition as orphanSql in
-- lib/risansi-auth.ts, spelled out here because a migration cannot import it.
-- Admins and sysadmins are never strangers; a client with no owner has nobody
-- to move the record to and is left as it is.
CREATE TEMP TABLE orphan_opps AS
  SELECT o.id, o.rep_id AS from_rep, c.primary_rep_id AS to_rep, o.stage, c.legal_name, COALESCE(o.quote_ref, o.product) AS label
    FROM opportunities o
    JOIN clients c ON c.id = o.client_id
   WHERE o.stage IN ('Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold')
     AND c.primary_rep_id IS NOT NULL
     AND o.rep_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users ua WHERE ua.id = o.rep_id AND ua.role IN ('admin', 'sysadmin'))
     AND c.primary_rep_id IS DISTINCT FROM o.rep_id
     AND NOT EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = c.id AND s.rep_id = o.rep_id)
     AND NOT (c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = o.rep_id))
     AND NOT EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = c.id
                      AND s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = o.rep_id));

CREATE TEMP TABLE orphan_visits AS
  SELECT v.id, v.rep_id AS from_rep, c.primary_rep_id AS to_rep, v.visit_date, c.legal_name
    FROM visits v
    JOIN clients c ON c.id = v.client_id
   WHERE v.status <> 'completed' AND v.submitted_at IS NULL
     AND c.primary_rep_id IS NOT NULL
     AND v.rep_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users ua WHERE ua.id = v.rep_id AND ua.role IN ('admin', 'sysadmin'))
     AND c.primary_rep_id IS DISTINCT FROM v.rep_id
     AND NOT EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = c.id AND s.rep_id = v.rep_id)
     AND NOT (c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = v.rep_id))
     AND NOT EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = c.id
                      AND s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = v.rep_id));

-- Audit first, while the old rep is still on the row.
INSERT INTO audit_log (actor_email, actor_role, action, entity_type, entity_id, entity_label, summary, metadata)
SELECT 'migration:0076', 'system', 'reassign', 'opportunity', x.id::text, x.legal_name || ' · ' || x.label,
       'Moved from ' || f.name || ' to ' || t.name || ', the client''s primary rep — the opportunity was on a client its rep did not work',
       jsonb_build_object('from_rep_id', x.from_rep, 'to_rep_id', x.to_rep, 'stage', x.stage, 'migration', '0076')
  FROM orphan_opps x JOIN users f ON f.id = x.from_rep JOIN users t ON t.id = x.to_rep;

INSERT INTO audit_log (actor_email, actor_role, action, entity_type, entity_id, entity_label, summary, metadata)
SELECT 'migration:0076', 'system', 'reassign', 'visit', x.id::text, x.legal_name || ' · ' || x.visit_date::text,
       'Moved from ' || f.name || ' to ' || t.name || ', the client''s primary rep — the visit was on a client its rep did not work',
       jsonb_build_object('from_rep_id', x.from_rep, 'to_rep_id', x.to_rep, 'migration', '0076')
  FROM orphan_visits x JOIN users f ON f.id = x.from_rep JOIN users t ON t.id = x.to_rep;

UPDATE opportunities o SET rep_id = x.to_rep, updated_at = NOW() FROM orphan_opps x WHERE x.id = o.id;
UPDATE visits v SET rep_id = x.to_rep, updated_at = NOW() FROM orphan_visits x WHERE x.id = v.id;

-- Dnyanyogi Shivkumar Swami Sugar, back.
UPDATE clients SET deleted_at = NULL, updated_at = NOW() WHERE code = 'BIJA01D019' AND deleted_at IS NOT NULL;
INSERT INTO audit_log (actor_email, actor_role, action, entity_type, entity_id, entity_label, summary)
SELECT 'migration:0076', 'system', 'restore', 'client', c.id::text, c.code || ' · ' || c.legal_name,
       'Restored: archived in the 30 Aug duplicate sweep, but it is a separate client from Indian Cane Power''s Dnyanyogi unit, and it carries a visit report'
  FROM clients c WHERE c.code = 'BIJA01D019';
