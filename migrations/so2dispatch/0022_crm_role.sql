-- 0022  Allow the CRM role on SO to Dispatch accounts.
--
-- Apply against ec_to_dispatch BEFORE any grant is set to crm at the hub
-- (migrations/identity/0010_so2dispatch_crm.sql). Until it is, an account
-- cannot take that role here: the copy of the grant's role into users.role is
-- refused. The same statement is in apps/so2dispatch/db/schema.sql.
-- Idempotent and additive: every role allowed before is still allowed.
--
-- CRM sees the Dashboard and the Orders list, read-only, for every SO — no
-- department pages and no chat.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD  CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'central_visibility', 'operations', 'accounts',
                    'drawing', 'planning', 'purchase', 'qc',
                    'assembly', 'dispatch', 'order_making', 'order_making_so', 'rep',
                    'rep_manager', 'crm'));
