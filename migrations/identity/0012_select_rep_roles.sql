-- 0012  Pump Selection: Rep and Rep Manager (read-only).
--
-- User decision 2026-11-01. Both see, read-only, the Dashboard, Enquiries,
-- Pump Selection and Reports for their own enquiries only: those whose client
-- they cover in the sales portal as primary or secondary rep (live, by client
-- code). A Rep Manager also sees the reps under them there (sales
-- manager_reps) and can pick one. Nothing about the team is stored here or in
-- the portal - it is read from Market Intell, as SO to Dispatch does.
--
-- Idempotent.

INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('select', 'rep', 'Rep',
   'Read-only: Dashboard, Enquiries, Pump Selection and Reports for the enquiries of the clients they cover in the sales portal (primary or secondary rep).', 3),
  ('select', 'rep_manager', 'Rep Manager',
   'What a Rep sees, read-only, for their own clients and for those of the reps who report to them in the sales portal; can pick a rep.', 4)
ON CONFLICT (app_slug, role) DO NOTHING;

UPDATE identity.app_roles SET sort_order = v.n
  FROM (VALUES
    ('user_master', 1), ('user_worker', 2), ('rep', 3), ('rep_manager', 4),
    ('selection_head', 5), ('pulley_owner', 6), ('admin', 7), ('system_admin', 8), ('user', 99)
  ) AS v(role, n)
 WHERE identity.app_roles.app_slug = 'select' AND identity.app_roles.role = v.role;
