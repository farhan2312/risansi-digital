-- 0007  SO to Dispatch's Rep Manager role.
--
-- A sales manager: what a Rep sees — read-only, can chat — for their own SOs
-- and for every SO of the reps who report to them. Who reports to whom is the
-- sales portal's manager_reps, read live by SO to Dispatch; nothing about the
-- team is stored at the hub or in that portal.
--
-- Apply migrations/so2dispatch/0002_rep_manager_role.sql to ec_to_dispatch
-- first: until that is in, an account there cannot hold this role.
INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('so2dispatch', 'rep_manager', 'Rep Manager',
   'What a Rep sees, read-only, for their own SOs and for the SOs of the reps who report to them in the sales portal. Can chat.', 4)
ON CONFLICT (app_slug, role) DO NOTHING;

-- The dropdown in the order that team thinks in, Rep Manager straight after
-- Rep. Explicit numbers rather than a shift, so running this twice changes
-- nothing the second time.
UPDATE identity.app_roles SET sort_order = v.n
  FROM (VALUES
    ('admin', 1), ('central_visibility', 2), ('rep', 3), ('rep_manager', 4),
    ('order_making', 5), ('order_making_so', 6), ('operations', 7), ('accounts', 8),
    ('drawing', 9), ('purchase', 10), ('qc', 11), ('planning', 12),
    ('assembly', 13), ('dispatch', 14)
  ) AS v(role, n)
 WHERE identity.app_roles.app_slug = 'so2dispatch' AND identity.app_roles.role = v.role;
