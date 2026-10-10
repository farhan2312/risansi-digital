-- The house account stops owning opportunities.
--
-- admin@risansi.com ("Risansi Admin", user 22) is the sysadmin login. It owns
-- no clients and has never made a visit, yet it is the rep on 372
-- opportunities: the June order-in-hand import (143 Won) and the 8 July quote
-- import (229) both fell back to it whenever the Excel rep column was blank,
-- "NI", or initials that matched nobody. Ownership then moved to the client,
-- the second import derived the rep from the client, and this batch was never
-- brought into line. It showed up as the biggest "rep" on the Quoted page.
--
-- Two moves, decided 12 Sep 2026:
--
--   1. Every opportunity the house account holds goes to its client's primary
--      rep — open and closed alike, so "won by rep" reads the same as "quoted
--      by rep". Where the rep was not the one who did the work, the audit row
--      says where it came from, and this file says why.
--
--   2. Where the client has no owner, the opportunity has no rep either. It
--      reads "Unassigned" on every screen — not a person's name — until an
--      admin gives the client an owner on Reps & Managers › Unassigned, at
--      which point setPrimaryRep moves it to them. rep_id therefore becomes
--      nullable. Nothing else is allowed to write NULL there: the create paths
--      still insist on an owner (resolveAssignableRepId), so NULL means one
--      thing only — the client had nobody when this ran, or when the record
--      was left behind by an owner being cleared.

ALTER TABLE opportunities ALTER COLUMN rep_id DROP NOT NULL;

COMMENT ON COLUMN opportunities.rep_id IS
  'The rep working this opportunity. NULL means the client had no owner when it was re-homed (migration 0073) — shown as Unassigned, and filled in by setPrimaryRep the moment the client gets one. New opportunities always carry an owner.';

-- One audit row per opportunity, written BEFORE the update so the old owner is
-- still readable. actor is the migration, not a person.
INSERT INTO audit_log (actor_email, actor_role, action, entity_type, entity_id, entity_label, summary, metadata)
SELECT 'migration:0073', 'system', 'reassign', 'opportunity', o.id::text,
       c.legal_name || ' · ' || COALESCE(o.quote_ref, o.product),
       CASE WHEN c.primary_rep_id IS NULL
            THEN 'Taken off the house account (Risansi Admin); the client has no owner, so it is Unassigned until one is set'
            ELSE 'Re-homed from the house account (Risansi Admin) to ' || u.name || ', the client''s primary rep'
       END,
       jsonb_build_object('from_rep_id', o.rep_id, 'to_rep_id', c.primary_rep_id, 'stage', o.stage, 'migration', '0073')
  FROM opportunities o
  JOIN clients c ON c.id = o.client_id
  LEFT JOIN users u ON u.id = c.primary_rep_id
 WHERE o.rep_id = 22;

UPDATE opportunities o
   SET rep_id = c.primary_rep_id,           -- NULL where the client has no owner
       updated_at = NOW()
  FROM clients c
 WHERE c.id = o.client_id
   AND o.rep_id = 22;
