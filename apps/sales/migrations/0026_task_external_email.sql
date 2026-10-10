-- Action items (tasks) can be assigned to someone outside the system via
-- assigned_to_external (a free-text name). Capture their email too so they can
-- be notified the same way in-system reps are.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to_external_email text;
