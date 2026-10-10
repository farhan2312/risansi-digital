-- Free-text remark for a pump's condition/status, captured in the visit report
-- alongside the Condition dropdown (which now also offers Running / Standby).
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS condition_remark text;
