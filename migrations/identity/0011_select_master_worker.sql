-- 0011  Pump Selection: User splits into User-Master and User-Worker.
--
-- User decision 2026-10-31. A User-Master creates enquiries and assigns them,
-- to a worker or to herself, and can reassign them later. A User-Worker sees
-- only the enquiries assigned to them and works them; they can neither create
-- an enquiry nor edit its details. System Admins can do what the master does.
--
-- Rachna Chauhan is the master; every other plain User becomes a worker.
--
-- `user` stays in the vocabulary rather than being deleted: deleting it would
-- fail the (app_slug, app_role) foreign key for any grant still holding it,
-- and the portal reads a leftover `user` as a worker. It is relabelled and
-- sorted last so an approver picks one of the two real roles instead.
--
-- Old portal code reads an unknown role as a plain User, so applying this
-- ahead of the code changes nothing for anyone. Every changed grant ends that
-- person's session once (the portal's role check sees the role move), and they
-- sign in again. Idempotent.

INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('select', 'user_master', 'User-Master',
   'Creates enquiries and assigns them to a worker or to themselves, reassigns them, and works them like a worker.', 1),
  ('select', 'user_worker', 'User-Worker',
   'Works the enquiries assigned to them: pump selection and commercial offers. Cannot create an enquiry or edit its details.', 2)
ON CONFLICT (app_slug, role) DO NOTHING;

UPDATE identity.app_roles
   SET label = 'User (legacy - pick Master or Worker)',
       description = 'The role before the Master / Worker split. Read as User-Worker. Pick one of those instead.',
       sort_order = 99
 WHERE app_slug = 'select' AND role = 'user';

UPDATE identity.app_roles SET sort_order = v.n
  FROM (VALUES ('selection_head', 3), ('pulley_owner', 4), ('admin', 5), ('system_admin', 6)) AS v(role, n)
 WHERE identity.app_roles.app_slug = 'select' AND identity.app_roles.role = v.role;

-- Rachna is the master; the rest of the plain Users are workers.
UPDATE identity.app_grants g
   SET app_role = CASE WHEN u.email = 'rachna.chauhan@risansi.com' THEN 'user_master' ELSE 'user_worker' END,
       updated_at = now()
  FROM identity.users u
 WHERE u.id = g.user_id AND g.app_slug = 'select' AND g.app_role = 'user';
