-- 0009  Key/value app settings (sysadmin-editable). First use: the company-wide
-- annual revenue target (Crores) shown on the dashboard.

CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES ('annual_target_cr', '32')
ON CONFLICT (key) DO NOTHING;
