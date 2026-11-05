-- 0014  Pump Selection: Operation.
--
-- User decision 2026-11-05. Operation has two pages only, Pump Docs and Spare Docs:
-- the saved documents of the enquiries that were reviewed and sent to operation,
-- read-only. Everything else, pages and API, is closed to the role (apps/select
-- middleware.ts).
--
-- Idempotent.

INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('select', 'operation', 'Operation',
   'Read-only: Pump Docs and Spare Docs, the saved documents of the enquiries reviewed and sent to operation.', 5)
ON CONFLICT (app_slug, role) DO NOTHING;

UPDATE identity.app_roles SET sort_order = v.n
  FROM (VALUES
    ('user_master', 1), ('user_worker', 2), ('rep', 3), ('rep_manager', 4), ('operation', 5),
    ('selection_head', 6), ('pulley_owner', 7), ('admin', 8), ('system_admin', 9), ('user', 99)
  ) AS v(role, n)
 WHERE identity.app_roles.app_slug = 'select' AND identity.app_roles.role = v.role;
