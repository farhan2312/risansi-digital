-- 0005  The two SO to Dispatch roles the hub did not know about.
--
-- 0002 took that portal's roles from its own REQUESTABLE_ROLES list, which is
-- what the portal offers on its request form. Its `users` table actually holds
-- thirteen, and the two extra ones are not requestable because nobody requests
-- them — they are assigned. Found on 12 Oct while writing the Phase 5
-- handover, before the seed rather than during it.
--
-- `app_grants` has a composite foreign key on (app_slug, app_role), so a role
-- missing here cannot be stored at all: sixteen people, including that
-- portal's largest single group, would have been unapprovable.

INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  -- All fifteen holders are sales people, each with their own name in
  -- users.rep_name, and all fifteen exist in the sales portal as rep, manager
  -- or admin. So this is the rep an order belongs to, not a department.
  ('so2dispatch', 'rep', 'Sales Rep',
   'The orders of their own clients, as the rep they are assigned to. A sales role rather than a department one — every person holding it today is a rep or manager in the Sales Portal.', 11),

  -- Held by exactly one account, the makerso@risansi.com mailbox, named
  -- "order making SO". A second order-making login rather than a second kind
  -- of person. The description says what is verifiable and no more: how it
  -- differs from Order Making is a question for that portal's developer, and
  -- an invented description here is how an approver grants the wrong access.
  ('so2dispatch', 'order_making_so', 'Order Making (SO)',
   'A second Order Making login, held today only by the makerso@ mailbox. Check with the SO to Dispatch team before granting it to a person — Order Making is the usual choice.', 2)
ON CONFLICT (app_slug, role) DO NOTHING;

-- Renumbered so the approval dropdown reads in the order work moves, with the
-- two cross-cutting roles and Admin last. Display only; nothing reads it but
-- the form.
UPDATE identity.app_roles SET sort_order = v.n
  FROM (VALUES
    ('order_making', 1), ('order_making_so', 2), ('operations', 3), ('accounts', 4),
    ('drawing', 5), ('planning', 6), ('purchase', 7), ('qc', 8), ('assembly', 9),
    ('dispatch', 10), ('rep', 11), ('central_visibility', 12), ('admin', 13)
  ) AS v(role, n)
 WHERE identity.app_roles.app_slug = 'so2dispatch' AND identity.app_roles.role = v.role;
