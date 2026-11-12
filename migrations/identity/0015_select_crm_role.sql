-- 0015  Pump Selection: CRM (read-only).
--
-- User decision 2026-11-12. CRM sees, view only, the Dashboard, Enquiries, Pump
-- Selection and Client Operation Docs, for every enquiry (no rep scope). Every
-- other page goes to the dashboard (apps/select middleware.ts, lib/roles.ts
-- CRM_PAGES); nothing can be worked on, copied or saved.
--
-- Idempotent.

INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('select', 'crm', 'CRM',
   'Read-only: Dashboard, Enquiries, Pump Selection and Client Operation Docs, for every enquiry.', 6)
ON CONFLICT (app_slug, role) DO NOTHING;

UPDATE identity.app_roles SET sort_order = v.n
  FROM (VALUES
    ('user_master', 1), ('user_worker', 2), ('rep', 3), ('rep_manager', 4), ('operation', 5), ('crm', 6),
    ('selection_head', 7), ('pulley_owner', 8), ('admin', 9), ('system_admin', 10), ('user', 99)
  ) AS v(role, n)
 WHERE identity.app_roles.app_slug = 'select' AND identity.app_roles.role = v.role;
