-- Free-text resolution notes the sysadmin writes while working a bug: what the
-- root cause was, how it was fixed, what to verify. Shown in the bug detail modal.
ALTER TABLE bugs ADD COLUMN IF NOT EXISTS resolution_notes text;
