-- Three things the complaint form needs to record.
--
-- 1. Supply Through. A complaint that arrives from an OEM who supplied the pump
--    to the end client is a different conversation from one the client raises
--    directly, and there was nowhere to say which. When it came through an OEM,
--    the OEM is named from the client master (client_type = 'OEM', 302 of them),
--    so it is a link to a real account rather than typed text that cannot be
--    counted.
--
-- 2. A second responsible department, the one the TSM names. The existing field
--    is the Complaint Team's answer, corrected at investigation; the TSM's view
--    from the field is worth keeping beside it rather than overwriting it.
--
-- 3. Wrong / Short / Excess supply as their own defect categories. They were one
--    combined "Supply related (short / wrong / excess)", which cannot be counted
--    or filtered apart. The combined one stays active so the records already on
--    it remain valid and nothing is re-filed by guesswork.

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS supply_through text
    CHECK (supply_through IS NULL OR supply_through IN ('Direct', 'OEM')),
  ADD COLUMN IF NOT EXISTS oem_client_id integer REFERENCES clients(id),
  ADD COLUMN IF NOT EXISTS tsm_responsible_department text;

COMMENT ON COLUMN complaints.supply_through IS
  'Direct from the client, or through an OEM who supplied them the pump.';
COMMENT ON COLUMN complaints.oem_client_id IS
  'The OEM it came through — a client with client_type = ''OEM''. Set only when supply_through = ''OEM''.';
COMMENT ON COLUMN complaints.tsm_responsible_department IS
  'Who the TSM believes is responsible. Kept beside responsible_department, which is the Complaint Team''s answer.';

CREATE INDEX IF NOT EXISTS complaints_oem_client_idx ON complaints (oem_client_id) WHERE oem_client_id IS NOT NULL;

-- The three supply categories, after the combined one they split out of.
INSERT INTO complaint_lookups (kind, value, sort_order, is_active) VALUES
  ('defect_category', 'Wrong supply',  91, TRUE),
  ('defect_category', 'Short supply',  92, TRUE),
  ('defect_category', 'Excess supply', 93, TRUE)
ON CONFLICT (kind, value) DO UPDATE SET is_active = TRUE;
