-- The complaint module's departments, as the specification names them.
--
-- 0070 created user_departments with seven placeholder names read from the
-- first draft of the complaint specification: Quality, Service, Production,
-- Stores, Accounts, Purchase, Dispatch. The revised specification (11 Sep) names
-- the owner of every page itself, and there are five — read from the top of
-- each page sheet, confirmed 12 Sep: no Production team, and sales reps and
-- managers reach Page 1 through the roles they already hold, not a department.
--
--   Complaint Team   owns Pages 1, 3-8; runs non-technical investigations
--   QC               technical investigations, CAPA, online technical support
--   Quotation Team   raises the FR EC for a free replacement
--   Billing Team     returnable and repair paperwork
--   Purchase         vendor CAPA and vendor recovery
--
-- Nobody has been assigned a department yet (zero rows), so this is a rename
-- of the allowed list and nothing moves. "Responsible Department" on Pages 1
-- and 4 is a different thing — the six-value attribution list from the sheet
-- (BILLING TEAM, DRAWING TEAM, PACKING & DISPATCH, QC & PRODUCTION, QUOTATION
-- TEAM, RUBBER DEPT) — and lives in the complaint lookups, not here.

ALTER TABLE user_departments DROP CONSTRAINT IF EXISTS user_departments_department_check;
ALTER TABLE user_departments ADD CONSTRAINT user_departments_department_check
  CHECK (department = ANY (ARRAY['Complaint Team', 'QC', 'Quotation Team', 'Billing Team', 'Purchase']));

COMMENT ON TABLE user_departments IS
  'The complaint-module functions a user works in: Complaint Team, QC, Quotation Team, Billing Team, Purchase. Zero or more per user, independent of role. Decides which complaint pages they may edit.';
