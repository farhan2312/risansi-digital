-- 0013  SO to Dispatch's 360° View role.
--
-- Every SO, read-only, on the pages Admin ticks for the account in SO to
-- Dispatch (Users & Access). Apply migrations/so2dispatch/0023_view_360_role.sql
-- to ec_to_dispatch first: until that is in, an account there cannot hold
-- this role. Idempotent.
INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('so2dispatch', 'view_360', '360° View',
   'Every SO, read-only, on the pages Admin picks for the account in SO to Dispatch. No chat.', 6)
ON CONFLICT (app_slug, role) DO NOTHING;

-- 360° View straight after CRM; explicit numbers, so a re-run changes nothing.
UPDATE identity.app_roles SET sort_order = v.n
  FROM (VALUES
    ('admin', 1), ('central_visibility', 2), ('rep', 3), ('rep_manager', 4), ('crm', 5), ('view_360', 6),
    ('order_making', 7), ('order_making_so', 8), ('operations', 9), ('accounts', 10),
    ('drawing', 11), ('purchase', 12), ('qc', 13), ('planning', 14),
    ('assembly', 15), ('dispatch', 16)
  ) AS v(role, n)
 WHERE identity.app_roles.app_slug = 'so2dispatch' AND identity.app_roles.role = v.role;
