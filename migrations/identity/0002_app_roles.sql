-- 0002  The roles each application actually has, so an approver picks instead
--       of typing.
--
-- 0001 left `app_grants.app_role` as a free string, on the grounds that the
-- four portals share no role vocabulary. That reasoning holds — they really do
-- not — but it left the approval form as an empty box, and an empty box means
-- somebody eventually types `menager`. The grant would save, the person would
-- be told they were approved, and the portal would recognise nothing: approved
-- and unable to do anything, with nothing failing anywhere to say why.
--
-- So the vocabulary stays per-application, and gets written down.
--
-- The composite foreign key at the bottom is the part that matters. It makes a
-- role that does not exist impossible to store, rather than merely unlikely
-- because the UI offers a dropdown. A dropdown is a convenience; a constraint
-- is the rule.
--
-- Every role and label below is lifted from the portals' own source, not
-- invented here:
--   sales        apps/sales/lib/risansi-auth.ts         RisansiRole, ROLE_LEVEL
--   so2dispatch  ec_to_dispatch/lib/roles.ts            ROLE_LABELS, REQUESTABLE_ROLES
--   testing      risansi-testing  .../auditFormat.ts    ROLE_LABELS
--   select       risansi_pump_selection .../audit-report-pdf.ts  ROLE_LABELS

CREATE TABLE IF NOT EXISTS identity.app_roles (
  app_slug    text    NOT NULL REFERENCES identity.apps(slug) ON DELETE CASCADE,
  -- The exact string the portal stores and tests against. Not for display.
  role        text    NOT NULL,
  -- What a person reading the approval form should see.
  label       text    NOT NULL,
  -- One line on what it actually lets somebody do. `operations` and
  -- `central_visibility` are not self-explanatory to anyone outside that team,
  -- and an approver guessing between them is how the wrong access gets granted.
  description text    NOT NULL,
  sort_order  integer NOT NULL DEFAULT 100,
  PRIMARY KEY (app_slug, role)
);

-- ── Sales ─────────────────────────────────────────────────────────
-- A ranking: every check is `level >= required`. Except `staff`, which sits at
-- level 0 deliberately so it satisfies no rung at all and gets its doors opened
-- one at a time instead of by outranking anyone.
INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('sales', 'rep', 'Sales Rep',
   'Their own clients, visits and pipeline. The ordinary role for a sales engineer.', 1),
  ('sales', 'manager', 'Manager',
   'Everything a rep has, plus the clients and pipeline of the reps on their team.', 2),
  ('sales', 'staff', 'Staff (Complaints only)',
   'Complaints and read-only Client 360, and nothing else. Outranks nobody — this is not a junior rep.', 3),
  ('sales', 'admin', 'Admin',
   'Every client, visit and opportunity in the company, and the admin screens.', 4),
  ('sales', 'sysadmin', 'System Admin',
   'Everything an admin has, plus user management, targets, settings and password resets. Ten people already hold this.', 5)
ON CONFLICT (app_slug, role) DO NOTHING;

-- ── SO to Dispatch ────────────────────────────────────────────────
-- One role per department, so an order moves between teams rather than between
-- permission levels. Ordered as that portal's own REQUESTABLE_ROLES orders them.
INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('so2dispatch', 'order_making', 'Order Making',
   'Creates sales orders, by form or Excel, and fills in their client and purchase-order details. Sees nothing beyond that.', 1),
  ('so2dispatch', 'operations', 'Billing & Operations',
   'Owns the billing section of an order.', 2),
  ('so2dispatch', 'accounts', 'Accounts', 'Owns the accounts section of an order.', 3),
  ('so2dispatch', 'drawing', 'Drawing', 'Owns the drawing section of an order.', 4),
  ('so2dispatch', 'planning', 'Planning', 'Owns the planning section of an order.', 5),
  ('so2dispatch', 'purchase', 'Purchase', 'Owns the purchase section of an order.', 6),
  ('so2dispatch', 'qc', 'Quality',
   'Owns the QC section, except the required documents and target dates, which Central Visibility fills.', 7),
  ('so2dispatch', 'assembly', 'Assembly & Packing', 'Owns the assembly and packing section.', 8),
  ('so2dispatch', 'dispatch', 'Dispatch',
   'Invoices what has been packed and records the dispatch. A department after Assembly & Packing, not the packing team itself.', 9),
  ('so2dispatch', 'central_visibility', 'Central Visibility',
   'Cross-department: owns the order itself and can edit across every section.', 10),
  ('so2dispatch', 'admin', 'Admin',
   'Everything Central Visibility has, and manages users.', 11)
ON CONFLICT (app_slug, role) DO NOTHING;

-- ── Testing Portal ────────────────────────────────────────────────
-- `user` is the column default in that portal rather than a role anybody is
-- given on purpose, so it is listed last and described as what it is.
INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('testing', 'source', 'Source Team',
   'Raises test requisitions and follows their own through to results.', 1),
  ('testing', 'testing', 'Testing Team',
   'Schedules and performs tests, and records the results.', 2),
  ('testing', 'central-admin', 'Central Admin',
   'Across every requisition and the calendar, without user management.', 3),
  ('testing', 'admin', 'Admin', 'Everything, including user management.', 4),
  ('testing', 'user', 'User (unassigned)',
   'That portal''s column default rather than a deliberate grant. Pick a real role instead.', 9)
ON CONFLICT (app_slug, role) DO NOTHING;

-- ── Pump Selection ────────────────────────────────────────────────
-- Listed although `apps.needs_grant` is false for this one today, so flipping
-- that to true needs no further migration.
INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('select', 'user', 'User', 'Sizes pumps and builds commercial offers.', 1),
  ('select', 'selection_head', 'Selection Head',
   'Reviews and approves what the selection team produces.', 2),
  ('select', 'pulley_owner', 'Pulley Owner', 'Maintains the pulley and drive master data.', 3),
  ('select', 'admin', 'Admin', 'Every project and quotation, and the master data behind them.', 4),
  ('select', 'system_admin', 'System Admin', 'Everything, including user management.', 5)
ON CONFLICT (app_slug, role) DO NOTHING;

-- ── The constraint that makes the dropdown redundant ──────────────
--
-- (app_slug, app_role) must name a role that exists for that application.
--
-- MATCH SIMPLE is the default and is exactly what is wanted here: when any
-- column of the key is NULL the constraint is satisfied, so a Pending grant
-- with no role decided yet still saves, while an Approved one cannot carry a
-- role the portal has never heard of.
--
-- ON UPDATE CASCADE so renaming a role in a portal is a single UPDATE here and
-- every grant follows. ON DELETE RESTRICT so a role cannot be removed while
-- people still hold it — that should be a conversation, not a silent orphaning.
ALTER TABLE identity.app_grants
  DROP CONSTRAINT IF EXISTS app_grants_app_role_fkey;
ALTER TABLE identity.app_grants
  ADD CONSTRAINT app_grants_app_role_fkey
  FOREIGN KEY (app_slug, app_role) REFERENCES identity.app_roles (app_slug, role)
  ON UPDATE CASCADE ON DELETE RESTRICT;
