-- Two narrow sales roles: Client 360 View, and Action Register.
--
-- Numbered 0009, not 0007: the SO-to-Dispatch work landed 0007 and 0008 in
-- this directory while this was being written, and two files sharing a number
-- is how one of them silently stops being applied.
--
-- ── Why they exist ──────────────────────────────────────────────
--
-- On 16 Oct 2026, 21 of the 39 active people in the sales portal held `admin`
-- or `sysadmin`. Of the thirteen admins, exactly one owned any clients: the
-- house account carrying 563 of them. The other twelve owned nothing, had no
-- pipeline and, in ten cases, not a single action assigned. They were carrying
-- the highest ordinary role in the portal so they could look a customer up.
--
-- There was nothing narrower to give them. `rep` scopes to the accounts you
-- own, which for these twelve is none, so it shows an empty portal and sends
-- them straight back to asking for admin. `staff` is Complaints plus Client
-- 360, and handing Complaints to somebody who wants a phone number is its own
-- kind of wrong. So: two roles that do one thing each.
--
-- ── Where they sit ──────────────────────────────────────────────
--
-- sort_order places them below `rep`, before the ladder starts, because that
-- is what they are: not junior reps, not a rung. Like `staff` they score level
-- 0 in ROLE_LEVEL, satisfy no `hasRole` test, and have every door opened for
-- them by name in lib/risansi-role-paths.ts.
--
-- One role per person, so `registry` includes read-only Client 360 rather than
-- expecting somebody to hold two. An action hangs off a client; the register
-- is unusable without it.
--
-- `app_role` on the grant is what the portal actually reads — see
-- `role: g.app_role ?? sales.role ?? 'rep'` in apps/sales/lib/risansi-auth.ts
-- — so a grant edited here takes effect on the person's next click.

INSERT INTO identity.app_roles (app_slug, role, label, description, sort_order) VALUES
  ('sales', 'viewer', 'Client 360 View',
   'Every client, the whole 360 page, read-only, and the Excel export. No dashboards, no pipeline, no complaints, and nothing on a client can be changed. For somebody who needs to look a customer up.', -2),
  ('sales', 'registry', 'Action Register',
   'The Action Register: every action in the company visible, new ones can be raised against any client, and the ones they raised or are assigned to are theirs to edit and delete. Includes read-only Client 360, because an action hangs off a client.', -1)
ON CONFLICT (app_slug, role) DO NOTHING;

-- Re-point `staff` so the three narrow roles read as a family and the label
-- stops promising only complaints.
UPDATE identity.app_roles
   SET label = 'Complaints + Client 360',
       description = 'Complaints, and read-only Client 360 so an arriving complaint''s customer can be opened. Outranks nobody — this is not a junior rep.',
       sort_order = -3
 WHERE app_slug = 'sales' AND role = 'staff';
