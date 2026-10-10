-- Email for an external complaint handler (someone not in the system), so they
-- can be notified the same way in-system assignees are — mirrors
-- tasks.assigned_to_external_email.
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS assigned_to_external_email text;
