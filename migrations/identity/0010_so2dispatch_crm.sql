-- 0010  SO to Dispatch's CRM role.
--
-- The Dashboard and the Orders list, read-only, for every SO — no department
-- pages, no chat. Apply migrations/so2dispatch/0022_crm_role.sql to
-- ec_to_dispatch first: until that is in, an account there cannot hold this
-- role. Idempotent.
INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('so2dispatch', 'crm', 'CRM',
   'The Dashboard and the Orders list, read-only, for every SO. No department pages, no chat.', 5)
ON CONFLICT (app_slug, role) DO NOTHING;

-- CRM straight after the Rep roles; explicit numbers, so a re-run changes nothing.
UPDATE identity.app_roles SET sort_order = v.n
  FROM (VALUES
    ('admin', 1), ('central_visibility', 2), ('rep', 3), ('rep_manager', 4), ('crm', 5),
    ('order_making', 6), ('order_making_so', 7), ('operations', 8), ('accounts', 9),
    ('drawing', 10), ('purchase', 11), ('qc', 12), ('planning', 13),
    ('assembly', 14), ('dispatch', 15)
  ) AS v(role, n)
 WHERE identity.app_roles.app_slug = 'so2dispatch' AND identity.app_roles.role = v.role;
