-- Two lists replaced, and the old values kept so old records still read.
--
-- Action Taken. The old six described a kind of service — Repair, Paid
-- Replacement, Online Technical Support — which is not what page 5 is for. The
-- page records what we did next, and what we did next is what decides who the
-- work goes to (see 0108). The nine new values are those next steps.
--
-- Root Cause Category. Nine values that were a mix of a department
-- (Manufacturing, Assembly), a party (Customer, Vendor) and a stage
-- (Installation, Operation), which is three questions answered in one field.
-- It becomes three: Human Error, Design, Process. Each gets its own
-- sub-category list; only Human Error's is settled, so only it is seeded.
--
-- Nothing is deleted. Ten complaints are filed under Free Replacement, which
-- survives in both lists, and five under Online Technical Support, which does
-- not; seven root causes are Other and six Operation. Deleting the value would
-- leave those pages showing a blank where an answer was given. The rows go
-- inactive instead: gone from every dropdown, still resolving a label on the
-- records that carry them.
--
-- A value the Complaint Team added themselves is left active. It was not part
-- of the old list this migration is retiring and is not ours to withdraw.

-- ── Action Taken — the nine next steps ──────────────────────────────────────

INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active) VALUES
  ('action_category', 'Call Back Material',           NULL, 1, TRUE),
  ('action_category', 'Replace Material',             NULL, 2, TRUE),
  ('action_category', 'Dispatch Material',            NULL, 3, TRUE),
  ('action_category', 'Under Discussion with Client', NULL, 4, TRUE),
  ('action_category', 'Under Discussion with Vendor', NULL, 5, TRUE),
  ('action_category', 'Free Replacement',             NULL, 6, TRUE),
  ('action_category', 'Under Investigation',          NULL, 7, TRUE),
  ('action_category', 'Client Confirmation',          NULL, 8, TRUE),
  ('action_category', 'Visit Planned',                NULL, 9, TRUE)
ON CONFLICT (kind, value, (COALESCE(parent_value, ''))) DO UPDATE
  SET sort_order = EXCLUDED.sort_order, is_active = TRUE
  WHERE complaint_lookups.is_user_added = FALSE;

UPDATE complaint_lookups
   SET is_active = FALSE
 WHERE kind = 'action_category'
   AND is_user_added = FALSE
   AND value NOT IN (
     'Call Back Material', 'Replace Material', 'Dispatch Material',
     'Under Discussion with Client', 'Under Discussion with Vendor',
     'Free Replacement', 'Under Investigation', 'Client Confirmation',
     'Visit Planned');

-- ── Root Cause Category — three, and the causes under them ──────────────────

INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active) VALUES
  ('root_cause_category', 'Human Error', NULL, 1, TRUE),
  ('root_cause_category', 'Design',      NULL, 2, TRUE),
  ('root_cause_category', 'Process',     NULL, 3, TRUE)
ON CONFLICT (kind, value, (COALESCE(parent_value, ''))) DO UPDATE
  SET sort_order = EXCLUDED.sort_order, is_active = TRUE
  WHERE complaint_lookups.is_user_added = FALSE;

UPDATE complaint_lookups
   SET is_active = FALSE
 WHERE kind = 'root_cause_category'
   AND is_user_added = FALSE
   AND value NOT IN ('Human Error', 'Design', 'Process');

-- Design's and Process's sub-causes are still with the Complaint Team. Seeding
-- a guess would get it answered before the real list arrives, so only Human
-- Error's three go in and the Add On control carries the rest.
INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active) VALUES
  ('root_cause_sub', 'Wrong EC',      'Human Error', 1, TRUE),
  ('root_cause_sub', 'Wrong Packing', 'Human Error', 2, TRUE),
  ('root_cause_sub', 'Wrong Billing', 'Human Error', 3, TRUE)
ON CONFLICT (kind, value, (COALESCE(parent_value, ''))) DO UPDATE
  SET sort_order = EXCLUDED.sort_order, is_active = TRUE
  WHERE complaint_lookups.is_user_added = FALSE;
