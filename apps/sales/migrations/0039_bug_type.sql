-- Distinguish a bug report from a feature request. Chosen by the reporter,
-- editable by the sysadmin from the bug detail modal. Existing rows are bugs.
ALTER TABLE bugs ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'bug';  -- bug | feature
