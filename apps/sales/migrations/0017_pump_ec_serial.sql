-- Repoint client_pumps to the EC/Serial export (one row per unique pump serial).
-- The ERP "single serial per customer" data is wiped and reloaded from the
-- EC_SERIAL file via scripts/import-ec-serial.mjs.
--
-- Slims the table to the file's fields. so_date/ec_date are intentionally KEPT
-- (nullable, no longer populated or read) so the currently-deployed Client 360 /
-- print queries don't error during rollout; they can be dropped in a later
-- migration once the new code is live.

DELETE FROM client_pumps;   -- intentional wipe; reloaded from the EC/Serial file

ALTER TABLE client_pumps
  DROP COLUMN IF EXISTS cust_code_short,
  DROP COLUMN IF EXISTS consignee_name,
  DROP COLUMN IF EXISTS consignee_city,
  DROP COLUMN IF EXISTS so_val,
  DROP COLUMN IF EXISTS cust_po_number,
  DROP COLUMN IF EXISTS product_code,
  DROP COLUMN IF EXISTS product_name,
  DROP COLUMN IF EXISTS model_no_internal,
  DROP COLUMN IF EXISTS pump_speed,
  DROP COLUMN IF EXISTS drive_rating,
  DROP COLUMN IF EXISTS source_period;

-- Identity of a physical pump is its serial. Upserts (import, admin upload, the
-- visit-form editor) key on (client_id, pump_sl_no). Partial so serial-less rows
-- still append. Table is empty here, so the index always builds.
DROP INDEX IF EXISTS uq_client_pumps_upload_serial;
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_pumps_serial
  ON client_pumps (client_id, pump_sl_no)
  WHERE pump_sl_no IS NOT NULL AND pump_sl_no <> '';
