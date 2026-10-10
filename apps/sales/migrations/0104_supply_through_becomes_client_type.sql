-- Supply Through was always asking what kind of client this is.
--
-- The field holds Direct or OEM, which is the client's type, not a route the
-- goods took; everyone reading the form called it that anyway. A rename rather
-- than a new column, so whatever has been answered survives and the OEM
-- picker beside it (oem_client_id) keeps pointing at the same answer.
--
-- Nothing in SQL depends on the old name: 0089 created it and no view, index or
-- constraint other than its own value check names it. The check is recreated
-- under the new name because a renamed column keeps the old constraint name,
-- which then reads as a lie in the schema.

ALTER TABLE complaints RENAME COLUMN supply_through TO client_type;

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_supply_through_check;
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_client_type_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_client_type_check
  CHECK (client_type IS NULL OR client_type IN ('Direct', 'OEM'));

COMMENT ON COLUMN complaints.client_type IS
  'Whether the complaint comes from the end client directly or through an OEM who supplied them the pump. Asked at registration; when it is OEM, oem_client_id names the OEM. Renamed from supply_through.';
COMMENT ON COLUMN complaints.oem_client_id IS
  'The OEM it came through — a client with client_type = ''OEM''. Set only when complaints.client_type = ''OEM''.';
